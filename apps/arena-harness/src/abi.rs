use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Bar {
    pub open: i64,
    pub high: i64,
    pub low: i64,
    pub close: i64,
    pub volume: i64,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct EvalInputV1 {
    pub version: u8,
    pub window_id: [u8; 32],
    pub step_index: u32,
    pub bar_interval_seconds: u32,
    pub price_scale: u32,
    pub volume_scale: u32,
    pub cash_balance: i64,
    pub position_qty: i64,
    pub avg_entry_price: i64,
    pub max_leverage_bps: u32,
    pub initial_margin_bps: u32,
    pub maintenance_margin_bps: u32,
    pub lookback_len: u16,
    pub ohlcv: Vec<Bar>,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct EvalOutputV1 {
    pub version: u8,
    pub action_type: u8,
    pub order_qty: i64,
    pub err_code: u16,
    pub reserved: [u8; 8],
}

impl EvalOutputV1 {
    pub fn hold(err_code: u16) -> Self {
        Self {
            version: 1,
            action_type: 0,
            order_qty: 0,
            err_code,
            reserved: [0u8; 8],
        }
    }
}

pub const OUTPUT_LEN: usize = 20;
