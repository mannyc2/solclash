SolClash Core Spec (BTC-PERP Arena)

1. Scope
   This spec defines the deterministic BTC-PERP arena used to evaluate agent-written
   on-chain policy programs. The simulator is replay-only and does not implement
   the Solana VM beyond a fixed ABI invocation.

2. Instrument

- Symbol: BTC-PERP
- Quote currency: USDC
- Position unit: BTC (base units, signed integer)

3. Replay Data (Summary)

- OHLCV bars at a fixed interval (see Data/Ops spec for full schema).
- Windows are contiguous bar sequences with integrity checks.

4. Windowing and Sampling

- Window duration is fixed in config (number of bars).
- Windows overlap is capped by max_window_overlap_pct.
- Windows may be stratified by regime (volatility, trend, volume) when
  window_sampling.mode = "stratified". The default mode is "sequential".
- A fixed stress set can be included every round via window_sampling.stress_count.
  Window sampling is controlled by config:
- window_sampling.mode: "sequential" | "stratified"
- window_sampling.stress_count
- window_sampling.buckets (volatility, trend, volume)

5. Simulation Step
   At step t:

- The agent receives OHLCV bars up to t (inclusive) and account state via
  EvalInputV1 (see On-Chain ABI spec).
- The agent returns an action via EvalOutputV1.
- The simulator converts the action into a delta position:
  - HOLD: delta_qty = 0
  - BUY: delta_qty = +order_qty
  - SELL: delta_qty = -order_qty
  - CLOSE: delta_qty = -position_qty
- The simulator executes delta_qty at bar t+1 open.
- If t is the final bar in the window, no new trade is executed.
  Execution follows the microstructure rules in
  `docs/solclash-microstructure-spec.md`, including uniform-price execution
  from net flow across agents.

6. Execution Price and Slippage

- Execution price = bar t+1 open, adjusted by slippage.
- Slippage is a fixed bps value per arena config:
  exec*price = open_price * (1 + sign(delta*qty) * slippage_bps / 10000)
- sign(delta_qty) is +1 for buys and -1 for sells.
  For multi-agent rounds, execution uses uniform-price net flow and transient
  impact as defined in `docs/solclash-microstructure-spec.md`. Trades do not
  alter the tape.

7. Fees

- Taker fee charged on notional:
  fee = abs(delta*qty) * exec*price * taker_fee_bps / 10000
- Fees are deducted from cash balance at execution time.

8. Position and PnL Accounting
   State variables:

- cash_balance (USDC)
- position_qty (BTC, signed)
- avg_entry_price (USDC per BTC, fixed-point; 0 if flat)

Trade accounting:

- If position_qty and delta_qty have the same sign, update avg_entry_price using
  weighted average.
- If delta*qty reduces or flips the position, realize PnL on the closed portion:
  realized_pnl = closed_qty * (exec*price - avg_entry_price) * sign(position_qty)
- Update cash_balance by realized_pnl - fee.
- Update position_qty and avg_entry_price accordingly.

Mark-to-market:

- equity = cash_balance + position_qty \* mark_price
- mark_price uses bar close for the current step.

9. Margin and Liquidation
   Config parameters:

- max_leverage_bps
- initial_margin_bps
- maintenance_margin_bps
- liquidation_fee_bps

Rules:

- Notional = abs(position_qty) \* mark_price
- Required initial margin = notional \* initial_margin_bps / 10000
- Required maintenance margin = notional \* maintenance_margin_bps / 10000
- If equity < maintenance margin at bar close, the position is liquidated at the
  next bar open with liquidation_fee_bps applied. Position is set to zero.

10. Funding (Optional)

- funding_rate_bps_per_bar defaults to 0.
- If enabled, funding is applied each bar:
  funding*payment = position_qty * mark*price * funding_rate_bps_per_bar / 10000
  cash_balance -= funding_payment

11. Scoring
    Scores are derived from PnL, drawdown, and exposure as defined in the Data/Ops
    spec. Final scoring uses arena-specific weights from config.

12. Round Orchestration
    See docs/solclash-edit-phase-spec.md for the two-phase round lifecycle and
    apps/tournament/README.md for CLI usage and output structure.

13. Determinism

- All randomness is seeded per window.
- Same program + window id yields identical results.
- Non-deterministic calls are disallowed.

14. v1 Default Parameters

- bar_interval_seconds: 60
- lookback_len: 120
- window_duration_bars: 720
- slippage_bps: 5
- taker_fee_bps: 5
- initial_margin_bps: 1000
- maintenance_margin_bps: 500
- max_leverage_bps: 10000
- liquidation_fee_bps: 50
- funding_rate_bps_per_bar: 0
- initial_balances: [{mint: quote_mint, amount: 10000}]
