SolClash Data and Ops Spec (Perps)

1. Replay Data Schema
1.1 Instrument Metadata
- symbol: string (e.g., BTC-PERP)
- base_mint: string (e.g., BTC)
- quote_mint: string (e.g., USDC)
- price_scale: integer (fixed-point scale, e.g., 1_000_000)
- volume_scale: integer (fixed-point scale, e.g., 1_000_000)

1.2 OHLCV Bars
- symbol: string
- bar_start_ts_ms: integer
- bar_end_ts_ms: integer
- open: integer (fixed-point)
- high: integer (fixed-point)
- low: integer (fixed-point)
- close: integer (fixed-point)
- volume: integer (base units, fixed-point)

Example data file formats:
1) Raw bars (JSON array)
```
[
  { "symbol": "BTC-PERP", "bar_start_ts_ms": 0, "bar_end_ts_ms": 60000, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 10 }
]
```

2) Instrument + bars (JSON object)
```
{
  "instrument": {
    "symbol": "BTC-PERP",
    "base_mint": "BTC",
    "quote_mint": "USDC",
    "price_scale": 1000000,
    "volume_scale": 1000000
  },
  "bars": [
    { "symbol": "BTC-PERP", "bar_start_ts_ms": 0, "bar_end_ts_ms": 60000, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 10 }
  ]
}
```

1.3 Integrity Checks
- Bars are contiguous in time for the configured interval.
- open/high/low/close > 0
- low <= open/close <= high
- volume >= 0

2. Window Construction
- Window duration and overlap are configured per arena.
- A window is a contiguous sequence of bars with complete data.
- Windows failing integrity checks are excluded from sampling.

3. Accounting and Metrics
3.1 Base Currency and Fees
- base_mint is configured per arena (e.g., BTC for BTC-PERP).
- fee_mint is the quote_mint in v1 (e.g., USDC for perps).
- All fee charges are denominated in fee_mint.

3.2 Initial Balances
- Each window starts from initial_balances configured per arena.
- initial_balances are identical across agents (per-agent overrides are not
  implemented in v1).
- No balance carryover between windows in the same round.

3.3 Mark Prices
- For perps arenas, mark_price is the bar close price for the current step.
- If a bar is missing, the window is invalid.

3.4 Metrics (Per Window)
- PnL = equity_end - equity_start
- Drawdown = max(peak_equity - trough_equity) over the step series
- Exposure = time-weighted average of sum(abs(inventory_i * mark_price_i))

3.5 Aggregation (Per Round)
- PnL_total = sum(PnL_window)
- Drawdown_max = max(Drawdown_window)
- Exposure_avg = mean(Exposure_window)

3.6 Invalid Windows
A window is invalid if:
- required bars are missing
- data integrity checks fail
Invalid windows are excluded from aggregation and reported in summary.json.

3.7 Baseline Agents (v1)
Baselines are deterministic and used for debugging and calibration.
- BUY_AND_HOLD: Buy `order_qty` once at the first step, then HOLD.
- FLAT: Always HOLD (no position).

4. Configuration Schema
Config keys (optional keys noted):
- arena_id: string
- symbol: string (e.g., BTC-PERP)
- base_mint: string (e.g., BTC)
- quote_mint: string (e.g., USDC)
- bar_interval_seconds: integer
- price_scale: integer (fixed-point; optional, default 1_000_000)
- volume_scale: integer (fixed-point; optional, default 1_000_000)
- tape_source: object (see Tape Source schema; optional if --data provided)
- window_duration_bars: integer
- max_window_overlap_pct: integer (0-100)
- number_of_windows_per_round: integer
- window_sampling: object (see Window Sampling schema; optional)
- lookback_len: integer
- slippage_bps: integer
- impact_k_bps: integer
- impact_cap_bps: integer (optional)
- liquidity_multiplier: number
- min_liquidity: integer
- taker_fee_bps: integer
- initial_margin_bps: integer
- maintenance_margin_bps: integer
- max_leverage_bps: integer
- liquidation_fee_bps: integer
- funding_rate_bps_per_bar: integer
- initial_balances: list of {mint, amount}
- scoring_weights: object (pnl, drawdown, exposure) OR
- scoring_weights_reference: string (path or id; optional, default docs/scoring-weights.json)
- baseline_bots_enabled: list of bot_ids
- compute_unit_limit: integer (optional; default 200000)

Validation rules:
- All required keys must be present.
- All integers must be non-negative.
- maintenance_margin_bps <= initial_margin_bps.
- max_leverage_bps >= 10000.
- lookback_len < window_duration_bars.
- initial_balances must include quote_mint.

Tape Source schema:
- type: "historical" | "synthetic"
- historical:
  - dataset_id or path
  - bar_interval_seconds (optional; defaults to config bar_interval_seconds)
- synthetic:
  - generator_id
  - seed
  - params (free-form map)

Impact and liquidity defaults (v1):
- impact_k_bps: 5
- impact_cap_bps: 50
- liquidity_multiplier: 1.0
- min_liquidity: 1

Impact uses bar volume as liquidity:
liq = max(min_liquidity, bar.volume * liquidity_multiplier)
flow_ratio = abs(net_qty) / liq
impact_bps = min(impact_cap_bps, impact_k_bps * flow_ratio) (cap optional)

Scoring weights (v1):
- If scoring_weights is omitted, scoring_weights_reference defaults to docs/scoring-weights.json
- If scoring_weights_reference is an id (no "/" and no ".json"), it resolves to
  docs/scoring-weights/{id}.json.
- Score = pnl_weight * pnl + drawdown_weight * drawdown + exposure_weight * exposure

Window Sampling schema (v1):
- mode: "sequential" | "stratified"
- stress_count: integer (default 1)
- buckets:
  - volatility: integer (default 3)
  - trend: integer (default 3)
  - volume: integer (default 3)
- seed: string (optional; defaults to arena_id)

5. Logging Schema
All logs are JSONL unless stated otherwise.

5.1 policy_log.jsonl
- window_id
- step_index
- agent_id
- action_type
- order_qty
- status (OK or ERR)
- err_code

5.2 trade_log.jsonl
- window_id
- step_index
- agent_id
- delta_qty
- exec_price
- fee_paid
- slippage_bps
- impact_bps
- net_qty

5.3 equity_log.jsonl
- window_id
- step_index
- equity
- cash_balance
- position_qty
- mark_price

5.4 liquidation_log.jsonl
- window_id
- step_index
- agent_id
- liquidated_qty
- exec_price
- liquidation_fee

5.5 summary.json
- window_id
- metrics_by_agent: map of agent_id -> metrics (PnL, drawdown, exposure, fees, liquidation_count)
- invalid_window_reason (nullable)

5.6 round_meta.json
- round_start_ts
- round_end_ts
- winner
- scores by agent
- invalid_agents (map of agent_id -> reason)

5.7 tournament.json (local runner)
- arena config path
- list of agents
- per-round meta entries

Log locations:
- Game container writes to `logs/rounds/{round_num}/`.
- Host copies logs to `logs/rounds/{round_num}/`.
