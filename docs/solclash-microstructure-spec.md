SolClash Microstructure Spec (Anchored Tape + Transient Impact)

1. Scope
This spec defines a market microstructure model where the price tape is fixed
(historical or synthetic) while agent actions affect each other through
transient execution impact. The tape is never mutated by trades.

2. Tape Provider Interface
Arena configuration must define a `tape_source` object with one of:
- `type: historical`
  - `dataset_id` or `path`
  - `bar_interval_seconds` (optional; defaults to config bar_interval_seconds)
- `type: synthetic`
  - `generator_id`
  - `seed`
  - `params` (free-form map of generator parameters)

Determinism rule:
- Same `generator_id`, `seed`, and `params` must yield identical tapes.

3. Execution Sequencing (Multi-Agent)
At each step `t`:
1) Collect validated actions from all agents.
2) Convert actions to per-agent `delta_qty`:
   - HOLD: 0
   - BUY: +order_qty
   - SELL: -order_qty
   - CLOSE: -position_qty
3) Include forced liquidations scheduled for `t+1` open as additional
   `delta_qty` at that open.
4) Compute net flow: `net_qty = sum(delta_qty)`.

4. Uniform Execution Price
Liquidity and impact:
- `liq = max(min_liquidity, bar.volume * liquidity_multiplier)`
- `flow_ratio = abs(net_qty) / liq`
- `impact_bps = impact_k_bps * flow_ratio`
- If `impact_cap_bps` is set, `impact_bps = min(impact_cap_bps, impact_bps)`

Execution price:
- If `net_qty == 0`, `exec_price = bar.open`.
- Else:
  `exec_price = bar.open * (1 + sign(net_qty) * (slippage_bps + impact_bps) / 10000)`

All trades at that open execute at the same `exec_price`.
The tape is never altered by trades (transient impact only).

5. Determinism & Comparability
- Same tape for all agents in a round.
- Tape is identical across tournaments for the same dataset/seed.
- Trades do not alter future bars; execution impact is transient.

6. Examples (Doc-Level)
- Opposite trades: net_qty = 0 → exec_price = bar.open.
- Both buy: net_qty > 0 → exec_price increases by slippage + impact.
- Determinism: identical tape + actions ⇒ identical fills.
