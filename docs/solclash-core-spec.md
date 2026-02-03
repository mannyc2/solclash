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
  exec_price = open_price * (1 + sign(delta_qty) * slippage_bps / 10000)
- sign(delta_qty) is +1 for buys and -1 for sells.
For multi-agent rounds, execution uses uniform-price net flow and transient
impact as defined in `docs/solclash-microstructure-spec.md`. Trades do not
alter the tape.

7. Fees
- Taker fee charged on notional:
  fee = abs(delta_qty) * exec_price * taker_fee_bps / 10000
- Fees are deducted from cash balance at execution time.

8. Position and PnL Accounting
State variables:
- cash_balance (USDC)
- position_qty (BTC, signed)
- avg_entry_price (USDC per BTC, fixed-point; 0 if flat)

Trade accounting:
- If position_qty and delta_qty have the same sign, update avg_entry_price using
  weighted average.
- If delta_qty reduces or flips the position, realize PnL on the closed portion:
  realized_pnl = closed_qty * (exec_price - avg_entry_price) * sign(position_qty)
- Update cash_balance by realized_pnl - fee.
- Update position_qty and avg_entry_price accordingly.

Mark-to-market:
- equity = cash_balance + position_qty * mark_price
- mark_price uses bar close for the current step.

9. Margin and Liquidation
Config parameters:
- max_leverage_bps
- initial_margin_bps
- maintenance_margin_bps
- liquidation_fee_bps

Rules:
- Notional = abs(position_qty) * mark_price
- Required initial margin = notional * initial_margin_bps / 10000
- Required maintenance margin = notional * maintenance_margin_bps / 10000
- If equity < maintenance margin at bar close, the position is liquidated at the
  next bar open with liquidation_fee_bps applied. Position is set to zero.

10. Funding (Optional)
- funding_rate_bps_per_bar defaults to 0.
- If enabled, funding is applied each bar:
  funding_payment = position_qty * mark_price * funding_rate_bps_per_bar / 10000
  cash_balance -= funding_payment

11. Scoring
Scores are derived from PnL, drawdown, and exposure as defined in the Data/Ops
spec. Final scoring uses arena-specific weights from config.

12. Round Orchestration
- For each round, run N windows from the pool.
- Use identical windows for all agents.
- Aggregate metrics across windows to produce round score.

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

15. Starter Environment (Agent Codebase)
Agents begin from a starter repository that includes a minimal Solana program
template implementing the policy ABI.

See `docs/solclash-starter-contract.md` for the base contract requirements,
including deterministic error handling (default HOLD), Borsh types, and the
required file layout.

Required layout:
- program/ (Solana program)
  - Cargo.toml (crate name: solclash_policy)
  - src/lib.rs (exports the program entrypoint implementing evaluate_v1)
- scripts/ (optional helper scripts)
In this monorepo, the canonical starter template lives in `starter/`.

Base contract requirements summary:
- Uses raw `solana_program` + Borsh (no Anchor).
- Must accept exactly two accounts: input (read-only) and output (writable).
- Instruction data must be empty; otherwise output HOLD with an error code.
- Always writes an output and returns Ok(()) on any error.
- Default policy returns HOLD.

Validation rules:
- The harness runs `cargo build-sbf` in `program/`.
- The deploy artifact must exist at `program/target/deploy/solclash_policy.so`.
- If build fails or the artifact is missing, the submission is invalid.

Execution environment:
- The harness executes the program locally using `solana-program-test`.
- No external network access is allowed during evaluation.

16. Tournament Loop and Environments
The tournament follows a two-phase loop per round, aligned with CodeClash-style
evaluation.
The current local runner is documented in `docs/solclash-tournament.md`.
Note: the current implementation only provides the competition-phase runner.
The edit-phase harness and container orchestration are planned but not yet
implemented in this repo.

16.1 Phases
- Edit phase: each agent modifies its codebase within a fixed turn budget.
- Competition phase: the arena executes all agents on identical windows and
  computes scores.

16.2 Environment Separation
Planned (not yet implemented in local runner):
- Each agent runs in its own container during the edit phase.
- The arena runs in a separate game container during the competition phase.
- Before competition, each agent codebase is copied into the game container
  under `/{agent_name}`.

16.3 Submission Validation
For each agent, the arena must:
- run the build command (`cargo build-sbf` in `program/`)
- verify the deploy artifact exists at
  `program/target/deploy/solclash_policy.so`
If validation fails, the submission is invalid for that round and receives a
score of 0 for the round.

16.4 Competition Execution Contract
Each round executes the following steps:
1) validate_code(agent)
2) execute_round(valid_agents)
3) get_results(valid_agents)
The arena must produce a per-round results file and logs for all valid agents.

16.5 Log Injection
- After competition, the arena writes logs to the host under
  `logs/rounds/{round_num}/`.
- The entire round log folder is copied into each agent container at
  `logs/rounds/{round_num}/` before the next edit phase begins.

16.6 Metadata and Artifacts
- The arena must write a per-round results artifact containing:
  - winner
  - scores by agent
  - invalid_reason (if any)
  - round timestamps
The arena writes this artifact as round_meta.json in the round log folder.
- Tournament-level metadata must include:
  - arena config
  - list of agents
  - per-round results

16.8 Program Execution Harness (Local)
The competition phase executes policy programs using `solana-program-test`.

Required behavior:
- Load each agent program from `program/target/deploy/solclash_policy.so`.
- Create one input account and one output account per agent per step.
- Serialize EvalInputV1 into the input account, invoke `evaluate_v1`, then
  deserialize EvalOutputV1 from the output account.
- Enforce a fixed compute unit limit per invocation.
  - The limit is configured via compute_unit_limit (default 200000).
- If invocation fails or output is invalid, treat the action as HOLD.

16.7 Agent Harness (Claude Agent SDK)
The edit phase is implemented with the Claude Agent SDK. Each agent session is
initialized with a fixed system prompt and runs against its own codebase in an
isolated container.
This harness is planned but not yet implemented in the local runner.

Required harness settings:
- Working directory: repo root.
- Tooling: standard Claude Code tools (Read/Write/Edit/Glob/Grep/Bash).
- Permissions: must be non-interactive (no human approvals during tournament).
- Sandbox: enabled for all Bash commands.
- Network: disabled by default; if enabled, must use an explicit allowlist.
- Session settings must be deterministic across agents within a tournament.

v1 defaults (can be tuned):
- permissionMode: acceptEdits
- sandbox.enabled: true
- sandbox.autoAllowBashIfSandboxed: true
- settingSources: [] (no filesystem settings)
- maxTurns: 30 per edit phase
