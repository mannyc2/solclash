SolClash Tournament Runner (Local + Containerized)

This document describes the tournament runner and how arena + agents are composed.

Overview

- Runs N rounds in a two-phase loop:
  - **Edit phase**: each custom agent runs in its own container and edits its workspace.
  - **Competition phase**: the arena runs in a separate container.
- Writes round logs under `logs/rounds/{round_num}/`.
- Writes `round_meta.json` per round (winner, scores, timestamps, invalid agents).
- Writes edit logs under `logs/edits/{round_num}/{agent_id}/`.
- Copies each round log folder into each custom agent workspace at
  `logs/rounds/{round_num}/` (log injection).
- Produces `logs/tournament.json` with per-round metadata.

The core loop lives in `apps/tournament/src/runner.ts` (`runTournament()`).

CLI

```sh
bun run apps/tournament/src/cli.ts \
  --config arena-config.json \
  --rounds 3 \
  --output ./logs \
  --agent ./agents/team-a/solclash-agent.json \
  --edit-prompt default \
  --edit-concurrency 4
```

Agent manifests are first-class inputs. `--agent` must point to a manifest JSON file, not directly to a workspace directory.

Agent Manifest Contract

```json
{
  "id": "team-a",
  "arena_id": "btc-perp-v1",
  "provider": "anthropic",
  "workspace": "./workspace",
  "model": "claude-sonnet-4-20250514"
}
```

- Required: `id`, `arena_id`, `provider`, `workspace`
- Optional: `model`
- `workspace` is resolved relative to the manifest path
- `arena_id` must match tournament config `arena_id`
- Agent IDs must be unique in a run

Arena Resolution Contract

- The run config remains a full config file.
- `config.arena_id` is resolved through `@solclash/arenas`.
- The arena definition provides:
  - canonical starter path
  - workspace requirements
  - build command and artifact path contract
  - supported baseline list
  - canonical default config path

Tournament Validation Flow

1. Parse and validate full run config.
2. Resolve arena definition from `config.arena_id`.
3. Validate `baseline_bots_enabled` against arena-supported baselines.
4. Load all agent manifests from `--agent` arguments.
5. Validate manifests (schema, unique IDs, arena match).
6. Validate each manifest workspace against arena workspace requirements.
7. Run edit phase using each manifest provider/model.
8. Run competition phase using arena build/artifact contract.

Provider Handling

- `--provider` is removed.
- Provider is owned by each agent manifest (`provider` field).
- Required env vars are checked per agent provider before edit sessions start.

Notes

- Edit phase is enabled by default; use `--no-edit` to disable.
- The edit prompt is resolved from `prompts/edit/` by id, or by explicit path.
- Competition runs in the arena container.
- The per-round results artifact is `round_meta.json`.

Migration (Breaking)

Old:

```sh
--agent ./workspace --provider anthropic
```

New:

```sh
--agent ./path/to/solclash-agent.json
```
