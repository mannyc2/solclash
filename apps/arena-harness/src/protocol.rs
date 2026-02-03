use serde::{Deserialize, Serialize};
use serde_with::{serde_as, DisplayFromStr};

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum Request {
    #[serde(rename = "init")]
    Init(InitRequest),
    #[serde(rename = "eval")]
    Eval(EvalRequest),
    #[serde(rename = "shutdown")]
    Shutdown(ShutdownRequest),
}

#[derive(Debug, Deserialize)]
pub struct InitRequest {
    pub request_id: u64,
    pub programs: Vec<ProgramSpec>,
    pub compute_unit_limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct EvalRequest {
    pub request_id: u64,
    pub agent_id: String,
    pub input: EvalInputJson,
}

#[derive(Debug, Deserialize)]
pub struct ShutdownRequest {
    pub request_id: u64,
}

#[derive(Debug, Deserialize)]
pub struct ProgramSpec {
    pub id: String,
    pub so_path: String,
}

#[serde_as]
#[derive(Debug, Deserialize)]
pub struct EvalInputJson {
    pub version: u8,
    pub window_id: String,
    pub step_index: u32,
    pub bar_interval_seconds: u32,
    pub price_scale: u32,
    pub volume_scale: u32,
    #[serde_as(as = "DisplayFromStr")]
    pub cash_balance: i64,
    #[serde_as(as = "DisplayFromStr")]
    pub position_qty: i64,
    #[serde_as(as = "DisplayFromStr")]
    pub avg_entry_price: i64,
    pub max_leverage_bps: u32,
    pub initial_margin_bps: u32,
    pub maintenance_margin_bps: u32,
    pub lookback_len: u16,
    pub ohlcv: Vec<BarJson>,
}

#[serde_as]
#[derive(Debug, Deserialize)]
pub struct BarJson {
    #[serde_as(as = "DisplayFromStr")]
    pub open: i64,
    #[serde_as(as = "DisplayFromStr")]
    pub high: i64,
    #[serde_as(as = "DisplayFromStr")]
    pub low: i64,
    #[serde_as(as = "DisplayFromStr")]
    pub close: i64,
    #[serde_as(as = "DisplayFromStr")]
    pub volume: i64,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum Response {
    #[serde(rename = "ok")]
    Ok(OkResponse),
    #[serde(rename = "result")]
    Result(ResultResponse),
    #[serde(rename = "error")]
    Error(ErrorResponse),
}

#[derive(Debug, Serialize)]
pub struct OkResponse {
    pub request_id: u64,
}

#[derive(Debug, Serialize)]
pub struct ResultResponse {
    pub request_id: u64,
    pub agent_id: String,
    pub status: String,
    pub output: EvalOutputJson,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub request_id: u64,
    pub message: String,
}

#[serde_as]
#[derive(Debug, Serialize)]
pub struct EvalOutputJson {
    pub version: u8,
    pub action_type: u8,
    #[serde_as(as = "DisplayFromStr")]
    pub order_qty: i64,
    pub err_code: u16,
}
