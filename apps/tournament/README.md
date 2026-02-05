# @solclash/tournament

Multi-round tournament orchestrator. Runs a two-phase loop (edit + competition), tracks scores across rounds, and injects round logs into agent workspaces between rounds.

## Usage

```sh
solclash-tournament \
  --config arena-config.json \
  --data bars.json \
  --rounds 5 \
  --output ./logs \
  --agent ./agents/team-a/solclash-agent.json
```

Or via the root script:

```sh
bun run tournament -- --config arena-config.json --rounds 3
```

### Full Test (Edit + Competition)

The default `arena-config.json` requires enough bars to build windows. With
`window_duration_bars=720` and `number_of_windows_per_round=5`, you need at
least **3600 bars** when overlap is 0.

Generate a local bars file:

```sh
bun run data generate --out ./tmp/bars.json --count 4000
```

Create agent manifests:

```json
{
  "id": "team-a",
  "arena_id": "btc-perp-v1",
  "provider": "anthropic",
  "workspace": "./workspace",
  "model": "claude-sonnet-4-20250514"
}
```

Run one round:

```sh
export ANTHROPIC_API_KEY=your_key_here

bun run tournament -- \
  --config ./arena-config.json \
  --data ./tmp/bars.json \
  --rounds 1 \
  --output ./logs \
  --agent ./agents/team-a/solclash-agent.json
```

If you want competition-only, add `--no-edit`.

### Options

| Flag        | Short | Required | Default  | Description                                                        |
| ----------- | ----- | -------- | -------- | ------------------------------------------------------------------ |
| `--config`  | `-c`  | Yes      | --       | Path to arena config JSON. Must contain `arena_id`.                |
| `--data`    | `-d`  | No       | --       | Path to bar data file. Optional if `tape_source` is set in config. |
| `--rounds`  | `-r`  | No       | `1`      | Number of tournament rounds (multi-round mode only).               |
| `--output`  | `-o`  | No       | `./logs` | Output directory for logs and artifacts.                           |
| `--agent`   | `-a`  | No       | `[]`     | Paths to agent manifest JSON files (repeatable).                   |
| `--local`   |       | No       | `false`  | Skip Docker — compile and run agents directly on the host.         |
| `--harness` |       | No       | --       | Override harness binary path for local mode with on-chain agents.  |
| `--no-edit` |       | No       | `false`  | Disable the Claude Code edit phase.                                |

### Agent Manifest Validation

- Manifest schema requires:
  - `id: string`
  - `arena_id: string`
  - `provider: anthropic | openai | google | glm | kimi`
  - `workspace: string`
  - optional `model: string`
- `workspace` is resolved relative to the manifest path.
- `manifest.arena_id` must match `config.arena_id`.
- Agent IDs must be unique (and cannot collide with enabled baseline IDs).
- Workspaces are validated against arena requirements (`program/`, `program/src/`, `program/Cargo.toml`).

## Output

```
<output>/
├── tournament.json            # Tournament metadata, config, and all round results
├── edits/
│   └── 1/
│       └── <AGENT_ID>/
│           ├── edit_input.json # Serialized edit session input
│           ├── edit_meta.json  # Status + session IDs
│           └── sdk.jsonl       # SDK message stream
└── rounds/
    ├── 1/
    │   ├── summary.json       # Per-window metrics
    │   ├── round_results.json # Per-agent round scores
    │   ├── round_meta.json    # Winner, scores, invalid agents, timestamps
    │   └── <AGENT_ID>/
    │       └── policy_log.jsonl
    ├── 2/
    │   └── ...
    └── N/
        └── ...
```

`tournament.json` contains the full config, agent IDs, edit config, and an array of round results (each with `round_num` and `meta` including `winner`, `scores`, `invalid_agents`, and timestamps).

## Edit Phase (Containerized)

The edit phase runs each non-builtin agent in a dedicated container (`solclash-agent`) and copies the workspace back only on success. The prompt is deterministic per tournament and comes from the built-in `default` prompt or an explicit file path.

API keys are forwarded into each agent container based on the agent manifest `provider`.

| Provider    | API Key Env (required) | Base URL Env (optional) |
| ----------- | ---------------------- | ----------------------- |
| `anthropic` | `ANTHROPIC_API_KEY`    | `ANTHROPIC_BASE_URL`    |
| `openai`    | `OPENAI_API_KEY`       | `OPENAI_BASE_URL`       |
| `google`    | `GOOGLE_API_KEY`       | `GOOGLE_BASE_URL`       |
| `glm`       | `GLM_API_KEY`          | `GLM_BASE_URL`          |
| `kimi`      | `KIMI_API_KEY`         | `KIMI_BASE_URL`         |

Provider-vs-provider runs are done by passing multiple manifests with different `provider` values:

```sh
bun run tournament -- \
  --config ./arena-config.json \
  --data ./tmp/bars.json \
  --rounds 1 \
  --agent ./agents/anthropic/solclash-agent.json \
  --agent ./agents/openai/solclash-agent.json
```

The system validates required environment variables before starting the edit phase.

## Local Mode

Use `--local` to skip Docker and run the competition engine directly on the host:

```sh
bun run tournament -- \
  --local \
  --no-edit \
  --rounds 1 \
  --config ./arena-config.json \
  --data ./tmp/bars.json \
  --output ./output \
  --agent ./agents/team-a/solclash-agent.json \
  --harness ./apps/arena-harness/target/release/solclash-harness
```

Workspace agents are compiled and run directly via the harness binary.
Results are written to `--output/rounds/1/`.

## Log Injection

When custom `--agent` manifests are provided, the full round log folder is copied into each agent workspace after every round:

```
<agent-workspace>/logs/rounds/<round_num>/
```

This lets agents inspect their own and peer results before subsequent rounds.

## Docker Images

The tournament runner expects these images:

- `solclash-base`
- `solclash-agent`
- `solclash-arena`

Build them with:

```sh
./scripts/build-images.sh
```

## Migration (Breaking)

Old:

```sh
--agent ./workspace --provider anthropic
```

New:

```sh
--agent ./path/to/solclash-agent.json
```

Provider now lives in the agent manifest and `--provider` is removed.

## Tests

```sh
bun test apps/tournament/
```
