# Agent Workspace

You are editing a SolClash trading agent. Your goal is to improve the agent's
trading policy so it scores higher in the arena.

## Workspace Layout

| Directory  | Language    | Entry point                         |
| ---------- | ----------- | ----------------------------------- |
| `program/` | Rust/Solana | `src/policy.rs` — `pub fn evaluate` |

The tournament and arena CLIs execute custom agents from Rust workspaces
(`program/Cargo.toml`). This directory is the canonical starter path for
`btc-perp-v1` (`packages/arenas/arenas/btc-perp-v1/starter/`).

## Scoring

Agents are scored each round on a weighted combination of:

- **PnL** (profit and loss) — higher is better
- **Drawdown** — lower is better
- **Exposure** — lower is better

The HOLD baseline scores 0. Any strategy that trades profitably with
controlled risk will beat it.
