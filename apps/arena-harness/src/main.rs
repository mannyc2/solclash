mod abi;
mod error;
mod protocol;

use abi::{EvalInputV1, EvalOutputV1, Bar, OUTPUT_LEN};
use anyhow::{anyhow, Result};
use borsh::BorshDeserialize;
use error::HarnessError;
use protocol::{
    EvalInputJson, EvalOutputJson, Request, Response, ResultResponse,
};
use sha2::{Digest, Sha256};
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_sdk::account::AccountSharedData;
use solana_sdk::compute_budget::ComputeBudgetInstruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signer::keypair::read_keypair_file;
use solana_sdk::signer::Signer;
use solana_sdk::transaction::Transaction;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use tokio::io::{self, AsyncBufReadExt};

struct ProgramInfo {
    pub id: Pubkey,
}

struct HarnessState {
    pub context: ProgramTestContext,
    pub programs: HashMap<String, ProgramInfo>,
    pub compute_unit_limit: u32,
}

#[tokio::main]
async fn main() -> Result<()> {
    let stdin = io::BufReader::new(io::stdin());
    let mut lines = stdin.lines();

    let mut state: Option<HarnessState> = None;

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let request: Request = match serde_json::from_str(&line) {
            Ok(req) => req,
            Err(err) => {
                write_response(Response::Error(protocol::ErrorResponse {
                    request_id: 0,
                    message: format!("invalid request: {err}"),
                }))?;
                continue;
            }
        };

        match request {
            Request::Init(req) => {
                let compute_limit = req.compute_unit_limit.unwrap_or(200_000);
                match init_programs(req.programs).await {
                    Ok((context, programs)) => {
                        state = Some(HarnessState {
                            context,
                            programs,
                            compute_unit_limit: compute_limit,
                        });
                        write_response(Response::Ok(protocol::OkResponse {
                            request_id: req.request_id,
                        }))?;
                    }
                    Err(err) => {
                        write_response(Response::Error(protocol::ErrorResponse {
                            request_id: req.request_id,
                            message: err.to_string(),
                        }))?;
                    }
                }
            }
            Request::Eval(req) => {
                let st = match state.as_mut() {
                    Some(state) => state,
                    None => {
                        write_response(Response::Error(protocol::ErrorResponse {
                            request_id: req.request_id,
                            message: "not initialized".to_string(),
                        }))?;
                        continue;
                    }
                };
                match handle_eval(
                    &mut st.context,
                    &st.programs,
                    st.compute_unit_limit,
                    &req.agent_id,
                    req.input,
                )
                .await
                {
                    Ok(output) => {
                        let response = Response::Result(ResultResponse {
                            request_id: req.request_id,
                            agent_id: req.agent_id,
                            status: "OK".to_string(),
                            output: EvalOutputJson {
                                version: output.version,
                                action_type: output.action_type,
                                order_qty: output.order_qty,
                                err_code: output.err_code,
                            },
                        });
                        write_response(response)?;
                    }
                    Err(err) => {
                        write_response(Response::Error(protocol::ErrorResponse {
                            request_id: req.request_id,
                            message: err.to_string(),
                        }))?;
                    }
                }
            }
            Request::Shutdown(req) => {
                write_response(Response::Ok(protocol::OkResponse {
                    request_id: req.request_id,
                }))?;
                break;
            }
        }
    }

    Ok(())
}

async fn init_programs(
    programs: Vec<protocol::ProgramSpec>,
) -> Result<(ProgramTestContext, HashMap<String, ProgramInfo>)> {
    let staging_dir = std::env::temp_dir().join("solclash-harness-bpf");
    std::fs::create_dir_all(&staging_dir)?;

    // ProgramTest reads these env vars at construction, so set them before start.
    std::env::set_var("SBF_OUT_DIR", &staging_dir);
    std::env::set_var("BPF_OUT_DIR", &staging_dir);

    let mut program_test = ProgramTest::default();
    let mut program_map = HashMap::new();

    for prog in &programs {
        let so_path = PathBuf::from(&prog.so_path);
        let program_id = read_program_id(&so_path).unwrap_or_else(Pubkey::new_unique);

        let staged = staging_dir.join(format!("{}.so", prog.id));
        std::fs::copy(&so_path, &staged)?;

        program_map.insert(prog.id.clone(), ProgramInfo { id: program_id });
    }

    for prog in &programs {
        let info = &program_map[&prog.id];
        program_test.add_program(&prog.id, info.id, None);
    }

    let context = program_test.start_with_context().await;
    Ok((context, program_map))
}

async fn handle_eval(
    context: &mut ProgramTestContext,
    programs: &HashMap<String, ProgramInfo>,
    compute_unit_limit: u32,
    agent_id: &str,
    input_json: EvalInputJson,
) -> Result<EvalOutputV1> {
    let program = programs
        .get(agent_id)
        .ok_or_else(|| anyhow!(HarnessError::ProgramNotFound(agent_id.to_string())))?;

    let input = convert_input(input_json)?;
    let input_bytes = borsh::to_vec(&input)?;

    let input_pubkey = Pubkey::new_unique();
    let output_pubkey = Pubkey::new_unique();

    let rent = solana_sdk::rent::Rent::default();
    let mut input_account = AccountSharedData::new(
        rent.minimum_balance(input_bytes.len()),
        input_bytes.len(),
        &program.id,
    );
    input_account.set_data_from_slice(&input_bytes);
    let output_account = AccountSharedData::new(
        rent.minimum_balance(OUTPUT_LEN),
        OUTPUT_LEN,
        &program.id,
    );

    context.set_account(&input_pubkey, &input_account);
    context.set_account(&output_pubkey, &output_account);

    let compute_ix = ComputeBudgetInstruction::set_compute_unit_limit(compute_unit_limit);
    let eval_ix = Instruction {
        program_id: program.id,
        accounts: vec![
            AccountMeta::new_readonly(input_pubkey, false),
            AccountMeta::new(output_pubkey, false),
        ],
        data: vec![],
    };

    let recent_blockhash = context.banks_client.get_latest_blockhash().await?;
    let tx = Transaction::new_signed_with_payer(
        &[compute_ix, eval_ix],
        Some(&context.payer.pubkey()),
        &[&context.payer],
        recent_blockhash,
    );

    context.banks_client.process_transaction(tx).await?;

    let output_account = context
        .banks_client
        .get_account(output_pubkey)
        .await?
        .ok_or_else(|| anyhow!(HarnessError::EvalFailed("missing output account".into())))?;

    if output_account.data.len() < OUTPUT_LEN {
        return Ok(EvalOutputV1::hold(7));
    }

    let mut output = EvalOutputV1::try_from_slice(&output_account.data)?;
    output = validate_output(output);
    Ok(output)
}

fn validate_output(output: EvalOutputV1) -> EvalOutputV1 {
    if output.version != 1 {
        return EvalOutputV1::hold(6);
    }
    if (output.action_type == 1 || output.action_type == 2) && output.order_qty <= 0 {
        return EvalOutputV1::hold(6);
    }
    output
}

fn convert_input(input: EvalInputJson) -> Result<EvalInputV1> {
    let window_id = parse_window_id(&input.window_id)?;
    let mut bars = Vec::with_capacity(input.ohlcv.len());
    for bar in input.ohlcv {
        bars.push(Bar {
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
        });
    }

    Ok(EvalInputV1 {
        version: input.version,
        window_id,
        step_index: input.step_index,
        bar_interval_seconds: input.bar_interval_seconds,
        price_scale: input.price_scale,
        volume_scale: input.volume_scale,
        cash_balance: input.cash_balance,
        position_qty: input.position_qty,
        avg_entry_price: input.avg_entry_price,
        max_leverage_bps: input.max_leverage_bps,
        initial_margin_bps: input.initial_margin_bps,
        maintenance_margin_bps: input.maintenance_margin_bps,
        lookback_len: input.lookback_len,
        ohlcv: bars,
    })
}

fn parse_window_id(value: &str) -> Result<[u8; 32]> {
    // Accept a 64-char hex id directly, otherwise hash to a fixed 32-byte key.
    if value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit()) {
        let bytes = hex::decode(value)?;
        let mut out = [0u8; 32];
        out.copy_from_slice(&bytes);
        return Ok(out);
    }
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest[..]);
    Ok(out)
}

fn read_program_id(so_path: &Path) -> Option<Pubkey> {
    let file_name = so_path.file_name()?.to_string_lossy();
    let keypair_name = file_name.replace(".so", "-keypair.json");
    let keypair_path = so_path.with_file_name(keypair_name);
    if !keypair_path.exists() {
        return None;
    }
    read_keypair_file(&keypair_path).ok().map(|kp| kp.pubkey())
}

fn write_response(response: Response) -> Result<()> {
    let mut stdout = std::io::stdout();
    let line = serde_json::to_string(&response)?;
    stdout.write_all(line.as_bytes())?;
    stdout.write_all(b"\n")?;
    stdout.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use borsh::BorshDeserialize;
    use protocol::EvalInputJson;

    #[test]
    fn eval_output_roundtrip() {
        let output = EvalOutputV1 {
            version: 1,
            action_type: 0,
            order_qty: 0,
            err_code: 0,
            reserved: [0u8; 8],
        };
        let bytes = borsh::to_vec(&output).expect("serialize");
        let decoded = EvalOutputV1::try_from_slice(&bytes).expect("deserialize");
        assert_eq!(decoded.version, 1);
        assert_eq!(decoded.action_type, 0);
    }

    #[test]
    fn window_id_hashing() {
        let id = "test-window";
        let bytes = parse_window_id(id).expect("hash");
        assert_eq!(bytes.len(), 32);
    }

    #[test]
    fn parse_eval_input_json() {
        let json = r#"{
          "version":1,
          "window_id":"w1",
          "step_index":0,
          "bar_interval_seconds":60,
          "price_scale":1000000,
          "volume_scale":1000000,
          "cash_balance":"10000",
          "position_qty":"0",
          "avg_entry_price":"0",
          "max_leverage_bps":10000,
          "initial_margin_bps":1000,
          "maintenance_margin_bps":500,
          "lookback_len":1,
          "ohlcv":[{"open":"100","high":"101","low":"99","close":"100","volume":"10"}]
        }"#;
        let parsed: EvalInputJson = serde_json::from_str(json).expect("parse");
        assert_eq!(parsed.cash_balance, 10000);
        assert_eq!(parsed.ohlcv.len(), 1);
    }
}
