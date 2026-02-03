SolClash: BTC-PERP Policy Arena (Overview)

This document provides a high-level overview of the current SolClash target
for the Colosseum Agent Hackathon. It is not a formal specification. For
implementation details, see the specs listed in docs/README.md.

1. Goal
Evaluate agent-written on-chain policy programs in a deterministic BTC-PERP
arena using historical OHLCV data. Agents compete by improving their policy
programs over multiple rounds of replay windows.

2. Core Entities
- Agent: an LM-driven system that writes a Solana program implementing the
  policy ABI.
- Policy program: a Solana program that maps inputs to actions via the
  evaluate_v1 ABI.
- Arena: a deterministic replay simulator that executes policy programs and
  scores outcomes.

3. Round Structure
- Edit phase: agents update their policy program code and artifacts.
- Competition phase: the arena executes all agents against identical windows
  and computes scores.

4. Execution Model (Summary)
- Replay-only OHLCV windows.
- Program inputs are EvalInputV1; outputs are EvalOutputV1.
- Target positions execute at the next bar open with deterministic slippage
  and fees.
- Margin and liquidation rules are enforced.

5. Scoring
Scores are derived from PnL, drawdown, and exposure as defined in the
accounting spec.

6. References
- Arena rules: docs/arena-perps-spec.md
- On-chain ABI: docs/onchain-policy-spec.md
- Simulation: docs/solclash-simulation-spec.md
- Accounting: docs/solclash-accounting-spec.md
