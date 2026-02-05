# SolClash Documentation

Deterministic BTC-PERP arena for evaluating agent-written on-chain policy programs.
Agents compete by improving Solana programs over multiple rounds of historical replay.

## Specs

| Document                                                           | Covers                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [solclash-core-spec.md](solclash-core-spec.md)                     | Simulation rules: instrument, windowing, execution, fees, accounting, margin, scoring |
| [solclash-edit-phase-spec.md](solclash-edit-phase-spec.md)         | Round lifecycle, container orchestration, edit-phase harness interface                |
| [solclash-onchain-abi.md](solclash-onchain-abi.md)                 | EvalInputV1/EvalOutputV1 Borsh ABI                                                    |
| [solclash-starter-contract.md](solclash-starter-contract.md)       | Starter Solana program layout and entrypoint contract                                 |
| [solclash-microstructure-spec.md](solclash-microstructure-spec.md) | Anchored tape, uniform execution price, transient impact                              |
| [solclash-data-ops.md](solclash-data-ops.md)                       | Data schemas, config, logging, window sampling                                        |
| [engineering-quality.md](engineering-quality.md)                   | CI gates, lint policy, PR expectations                                                |

## Package & App Docs

| README                                                | Covers                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| [apps/tournament](../apps/tournament/README.md)       | Tournament CLI: usage, flags, agent manifests, Docker, output structure |
| [apps/arena-harness](../apps/arena-harness/README.md) | Rust harness: JSON protocol, Borsh serialization                        |
| [packages/simulator](../packages/simulator/README.md) | Simulation engine API: runWindow, execution, accounting, baselines      |
| [packages/data](../packages/data/README.md)           | Data loading API: loadTape, validateBars, windowing, Binance fetcher    |

## Scoring Weights

- [scoring-weights.json](scoring-weights.json) — default weights
- [scoring-weights/](scoring-weights/) — named weight sets
