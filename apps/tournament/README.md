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

Run one round (uses Claude Code subscription by default, or set `ANTHROPIC_API_KEY` to override):

```sh
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
    │   ├── snapshot_index.json # Code snapshot index for UI
    │   ├── workspaces/
    │   │   └── <AGENT_ID>/     # Pre-competition code snapshot
    │   └── <AGENT_ID>/
    │       └── policy_log.jsonl
    ├── 2/
    │   └── ...
    └── N/
        └── ...
```

`tournament.json` contains the full config, agent IDs, edit config, and an array of round results (each with `round_num` and `meta` including `winner`, `scores`, `invalid_agents`, and timestamps).

`snapshot_index.json` maps each agent to its pre-competition workspace snapshot (if any) and score for the round.

## Edit Phase (Containerized)

The edit phase runs each non-builtin agent in a dedicated container (`solclash-agent`) and copies the workspace back only on success. The prompt is deterministic per tournament and comes from the built-in `default` prompt or an explicit file path.

A single Docker image (`solclash-agent`) contains all provider CLIs. The edit-runner dispatches by `provider`:

| Provider    | Runner               | Auth                                                   |
| ----------- | -------------------- | ------------------------------------------------------ |
| `anthropic` | Claude SDK `query()` | Claude Code subscription (auto) or `ANTHROPIC_API_KEY` |
| `google`    | `gemini -p` CLI      | `~/.gemini/` OAuth mount (read-only)                   |
| `openai`    | `codex exec` CLI     | `~/.codex/` OAuth mount (read-only)                    |
| `kimi`      | Claude SDK `query()` | `KIMI_API_KEY` + `KIMI_BASE_URL` env vars              |
| `glm`       | Claude SDK `query()` | `GLM_API_KEY` + `GLM_BASE_URL` env vars                |

### Authentication

**anthropic** — Uses your Claude Code subscription automatically. In local mode the SDK reads Keychain directly. In Docker mode the orchestrator extracts the OAuth token from macOS Keychain and passes it as `CLAUDE_CODE_OAUTH_TOKEN`. No `ANTHROPIC_API_KEY` needed.

**google** — Run `gemini` once locally and complete the "Login with Google" OAuth flow. Credentials are cached in `~/.gemini/` and mounted read-only into the container automatically.

**openai** — Run `codex` once locally and complete the "Sign in with ChatGPT" flow. Credentials are cached in `~/.codex/` and mounted read-only into the container automatically.

**kimi** — Set `KIMI_API_KEY` and `KIMI_BASE_URL` in your environment. These are mapped to `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` inside the container so the Claude SDK routes to the Kimi endpoint.

**glm** — Set `GLM_API_KEY` and `GLM_BASE_URL` in your environment. Same mapping as kimi.

### Multi-Provider Example

Provider-vs-provider runs are done by passing multiple manifests with different `provider` values:

```sh
bun run tournament -- \
  --config ./arena-config.json \
  --data ./tmp/bars.json \
  --rounds 1 \
  --agent ./agents/anthropic/solclash-agent.json \
  --agent ./agents/openai/solclash-agent.json
```

The system validates required environment variables before starting the edit phase. OAuth-based providers (`google`, `openai`) skip API key validation since they authenticate via mounted credential directories.

### Prerequisites (Local Mode)

For `--local` mode with non-Anthropic providers, install the CLI tools globally:

```sh
npm install -g @google/gemini-cli @openai/codex
```

In Docker mode these are pre-installed in the `solclash-agent` image.

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
