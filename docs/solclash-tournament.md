SolClash Tournament Runner (Local)

This document describes the local tournament runner. It is a placeholder for
the containerized edit/competition orchestration described in the core spec.

Overview
- Runs N rounds by calling `executeRound()` directly from `@solclash/arena`.
- Writes round logs under logs/rounds/{round_num}/.
- Writes `round_meta.json` per round (winner, scores, timestamps).
- Copies each round log folder into each agent workspace at
  logs/rounds/{round_num}/ (log injection).
- Produces logs/tournament.json with per-round metadata.

The core loop lives in `apps/tournament/src/runner.ts` (`runTournament()`),
which can be imported and tested without the CLI.

CLI
```
bun run apps/tournament/src/cli.ts \
  --config arena-config.json \
  --rounds 3 \
  --output ./logs \
  --agents ./my-agent.ts \
  --onchain-agents ./agent-a
```

Notes
- Calls `executeRound()` from `@solclash/arena` directly for TS agents;
  on-chain agents still require the harness binary and cargo build-sbf.
- The per-round results artifact is round_meta.json (written by the tournament runner).

Agent IDs
- On-chain agents: directory basename (e.g. `./agent-a` → `agent-a`).
- TS/JS agents: filename without extension (e.g. `./my-agent.ts` → `my-agent`).
- Builtin agents: their registered name (e.g. `BUY_AND_HOLD`).
