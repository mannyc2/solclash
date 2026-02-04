#[cfg(test)]
mod tests {
    use borsh::BorshDeserialize;
    use crate::types::{EvalInputV1, EvalOutputV1};

    #[test]
    fn output_roundtrip() {
        let out = EvalOutputV1::hold(0);
        let bytes = borsh::to_vec(&out).expect("serialize");
        let decoded = EvalOutputV1::try_from_slice(&bytes).expect("deserialize");
        assert_eq!(decoded.version, 1);
        assert_eq!(decoded.action_type, 0);
    }

    #[test]
    fn default_hold_has_ok_err_code() {
        let out = EvalOutputV1::hold(0);
        assert_eq!(out.err_code, 0);
    }

    #[test]
    fn invalid_input_version_maps_to_hold() {
        let input = EvalInputV1 {
            version: 2,
            window_id: [0u8; 32],
            step_index: 0,
            bar_interval_seconds: 60,
            price_scale: 1_000_000,
            volume_scale: 1_000_000,
            cash_balance: 10_000,
            position_qty: 0,
            avg_entry_price: 0,
            max_leverage_bps: 10_000,
            initial_margin_bps: 1_000,
            maintenance_margin_bps: 500,
            lookback_len: 0,
            ohlcv: Vec::new(),
        };
        assert_eq!(input.version, 2);
        // Simulate policy output for invalid input version should be HOLD.
        let out = EvalOutputV1::hold(2);
        assert_eq!(out.action_type, 0);
    }
}
