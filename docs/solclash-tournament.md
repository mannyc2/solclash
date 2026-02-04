SolClash Tournament Runner (Local + Containerized)

This document describes the tournament runner, including the containerized
edit/competition orchestration described in the core spec.

Overview

- Runs N rounds in a two-phase loop:
  - **Edit phase**: each agent runs in its own container and edits its workspace.
  - **Competition phase**: the arena runs in a separate container.
- Writes round logs under logs/rounds/{round_num}/.
- Writes `round_meta.json` per round (winner, scores, timestamps, invalids).
- Writes edit logs under logs/edits/{round_num}/{agent_id}/.
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
  --agent ./starter \
  --provider anthropic \
  --edit-prompt default \
  --edit-concurrency 4
```

Custom agents are Rust workspaces. Each `--agent` path must be a directory
containing `program/Cargo.toml`.

Provider specifies the LLM powering the edit phase (`anthropic`, `openai`,
`google`, `glm`, `kimi`). Defaults to `anthropic`.

Notes

- Edit phase is enabled by default; use `--no-edit` to disable it.
- The edit prompt is resolved from `prompts/edit/` by id, or by explicit path.
- Competition is executed in the arena container; Rust workspaces are built
  and validated inside that container.
- The per-round results artifact is round_meta.json (written by the tournament runner).

Agent IDs

- Rust agents: directory basename (e.g. `./starter` → `starter`).
- Builtin agents: their registered name (e.g. `BUY_AND_HOLD`).

Docker Images

- `solclash-base`: base image with bun + Rust + Solana toolchain.
- `solclash-agent`: edit-phase agent container (Claude Agent SDK).
- `solclash-arena`: arena container for competition phase.

Build images:

```
./scripts/build-images.sh
```
