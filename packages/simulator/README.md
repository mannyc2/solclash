# @solclash/simulator

Deterministic BTC-PERP simulation engine. Pure and synchronous — no I/O, trivially testable.
Used by the arena CLI and tournament runner for round execution.

## Core API

### `runWindow(config, bars, windowId, agents) -> WindowMultiResult`

Runs a single window simulation for all agents. This is where all spec rules converge:

1. Liquidation from previous bar (if flagged)
2. Funding payment
3. Agent evaluation (policy function receives lookback bars + account state)
4. Mark-to-market at bar close
5. Margin check at bar close
6. Trade execution at next bar's open

```ts
import {
  runWindow,
  BUY_AND_HOLD,
  FLAT,
  V1_DEFAULTS,
} from "@solclash/simulator";

const result = await runWindow(V1_DEFAULTS, bars, "w0", [
  { id: "agent-1", policy: BUY_AND_HOLD },
  { id: "agent-2", policy: FLAT },
]);
// result.agent_results["agent-1"].metrics    — WindowMetrics (pnl, drawdown, exposure, ...)
// result.agent_results["agent-1"].equity_log — per-step equity snapshots
// result.agent_results["agent-1"].trade_log  — executed trades
// result.agent_results["agent-1"].policy_log — agent actions
// result.agent_results["agent-1"].liquidation_log
// result.agent_results["agent-1"].final_account
```

### Building Blocks

Each component is independently importable and testable:

| Function                                                | Module          | Purpose                                           |
| ------------------------------------------------------- | --------------- | ------------------------------------------------- |
| `computeExecPrice(open, deltaQty, slippageBps)`         | `execution.ts`  | Applies directional slippage                      |
| `computeUniformExecPrice(open, netQty, config, volume)` | `execution.ts`  | Uniform-price execution with impact               |
| `computeFee(absQty, execPrice, feeBps)`                 | `execution.ts`  | Taker fee on notional                             |
| `applyTrade(account, deltaQty, execPrice, fee)`         | `accounting.ts` | Position update, weighted avg entry, realized PnL |
| `computeEquity(account, markPrice)`                     | `accounting.ts` | Mark-to-market equity                             |
| `checkMargin(account, markPrice, maintBps)`             | `margin.ts`     | Maintenance margin check                          |
| `liquidate(account, nextOpen, liqFeeBps)`               | `margin.ts`     | Force-close at next bar open                      |
| `applyFunding(account, markPrice, fundingBps)`          | `funding.ts`    | Per-bar funding payment                           |
| `computeWindowMetrics(id, equityCurve, fees, liqCount)` | `metrics.ts`    | PnL, drawdown, exposure from equity curve         |
| `computeScore(metrics, weights)`                        | `metrics.ts`    | Weighted score from metrics                       |
| `aggregateRound(windowMetrics[], weights)`              | `scoring.ts`    | Round-level aggregation                           |

### Configuration

Arena configs are validated at load time with `ArenaConfigSchema` (Zod). Key constraints: `maintenance_margin_bps <= initial_margin_bps`, `lookback_len < window_duration_bars`, and `initial_balances` must include the quote mint.

`V1_DEFAULTS` exports a complete default config (BTC-PERP, 1m bars, 720-bar windows, 10k USDC starting balance).

### Policy Validation

Invalid policy outputs are coerced to HOLD:

- **err_code 5** — policy function threw an exception
- **err_code 6** — invalid version, action type, non-positive qty on BUY/SELL, or margin/leverage violation

### Baselines

Two built-in deterministic policies for calibration and testing:

- **`BUY_AND_HOLD`** — Buys 1 unit at the first step, then holds
- **`FLAT`** — Always holds (no position)

```ts
import { BUY_AND_HOLD, FLAT } from "@solclash/simulator";
```

## Tests

```sh
bun test packages/simulator/
```

Unit tests cover execution math, accounting (same-dir add, partial close, full close, position flip), margin/liquidation, funding, metrics, scoring, and engine integration with baselines on synthetic data.
