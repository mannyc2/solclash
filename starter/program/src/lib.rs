use borsh::BorshDeserialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    pubkey::Pubkey,
};

mod errors;
mod policy;
mod types;
#[cfg(test)]
mod tests;

use errors::ErrCode;
use types::{EvalInputV1, EvalOutputV1};

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let mut accounts_iter = accounts.iter();
    let input_account = match next_account_info(&mut accounts_iter) {
        Ok(acc) => acc,
        Err(_) => return Ok(()),
    };
    let output_account = match next_account_info(&mut accounts_iter) {
        Ok(acc) => acc,
        Err(_) => return Ok(()),
    };

    if !instruction_data.is_empty() {
        return write_output(output_account, EvalOutputV1::hold(ErrCode::InvalidInstructionData as u16));
    }

    let input = match EvalInputV1::try_from_slice(&input_account.data.borrow()) {
        Ok(v) => v,
        Err(_) => {
            return write_output(output_account, EvalOutputV1::hold(ErrCode::InputDeserFail as u16));
        }
    };

    if input.version != 1 {
        return write_output(output_account, EvalOutputV1::hold(ErrCode::InvalidInputVersion as u16));
    }
    if input.lookback_len as usize != input.ohlcv.len() {
        return write_output(output_account, EvalOutputV1::hold(ErrCode::InvalidLookbackLen as u16));
    }

    let output = match policy::evaluate(&input) {
        Ok(v) => v,
        Err(_) => EvalOutputV1::hold(ErrCode::PolicyErr as u16),
    };

    let output = validate_output(output);
    write_output(output_account, output)
}

fn validate_output(mut output: EvalOutputV1) -> EvalOutputV1 {
    if output.version != 1 {
        return EvalOutputV1::hold(ErrCode::OutputInvalid as u16);
    }
    if (output.action_type == 1 || output.action_type == 2) && output.order_qty <= 0 {
        return EvalOutputV1::hold(ErrCode::OutputInvalid as u16);
    }
    output.reserved = [0u8; 8];
    output
}

fn write_output(output_account: &AccountInfo, output: EvalOutputV1) -> ProgramResult {
    let mut data = output_account.data.borrow_mut();
    let serialized = match borsh::to_vec(&output) {
        Ok(bytes) => bytes,
        Err(_) => {
            msg!("output serialization failed");
            let fallback = EvalOutputV1::hold(ErrCode::OutputSerFail as u16);
            match borsh::to_vec(&fallback) {
                Ok(bytes) => bytes,
                Err(_) => return Ok(()),
            }
        }
    };

    if data.len() < serialized.len() {
        return Ok(());
    }
    data[..serialized.len()].copy_from_slice(&serialized);
    Ok(())
}
