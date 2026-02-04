# @solclash/tournament

Multi-round tournament orchestrator. Runs a two-phase loop (edit + competition), tracks scores across rounds, and injects round logs into agent workspaces between rounds.

## Usage

```sh
solclash-tournament --config arena-config.json --data bars.json --rounds 5 --output ./logs --agent ./starter
```

Or via the root script:

```sh
bun run tournament -- --config arena-config.json --rounds 3 --edit-prompt default
```

### Full Test (Edit + Competition)

The default `arena-config.json` requires enough bars to build windows. With
`window_duration_bars=720` and `number_of_windows_per_round=5`, you need at
least **3600 bars** when overlap is 0.

Generate a local bars file:

```sh
bun run data generate --out ./tmp/bars.json --count 4000
```

Run a single round with Rust agent workspaces:

```sh
export ANTHROPIC_API_KEY=your_key_here

bun run tournament -- \
  --config ./arena-config.json \
  --data ./tmp/bars.json \
  --rounds 1 \
  --output ./logs \
  --agent ./starter \
  --provider anthropic \
  --edit-max-turns 5
```

If you want competition-only, add `--no-edit`.

### Options

| Flag                       | Short | Required | Default     | Description                                                                                    |
| -------------------------- | ----- | -------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `--config`                 | `-c`  | Yes      | --          | Path to arena config JSON (validated with Zod)                                                 |
| `--data`                   | `-d`  | No       | --          | Path to bar data file. Optional if `tape_source` is set in config.                             |
| `--rounds`                 | `-r`  | No       | `1`         | Number of tournament rounds                                                                    |
| `--output`                 | `-o`  | No       | `./logs`    | Output directory for tournament logs                                                           |
| `--agent`                  | `-a`  | No       | `[]`        | Paths to Rust agent workspaces (repeatable). Each workspace must contain `program/Cargo.toml`. |
| `--provider`               |       | No       | `anthropic` | LLM provider for the edit phase (`anthropic`, `openai`, `google`, `glm`, `kimi`)               |
| `--no-edit`                |       | No       | `false`     | Disable edit phase (competition only)                                                          |
| `--edit-prompt`            |       | No       | `default`   | Edit prompt id (`default`) or explicit file path                                               |
| `--edit-max-turns`         |       | No       | `30`        | Max edit turns per agent                                                                       |
| `--edit-concurrency`       |       | No       | `4`         | Max concurrent edit sessions                                                                   |
| `--edit-timeout-ms`        |       | No       | --          | Wall-clock timeout for edit sessions                                                           |
| `--edit-network-enabled`   |       | No       | `false`     | Allow network tools during edit (still allowlisted)                                            |
| `--edit-network-allowlist` |       | No       | `[]`        | Allowed hosts for WebFetch (repeatable)                                                        |
| `--edit-model`             |       | No       | --          | Override model name for the edit harness                                                       |

### Agent Workspace Validation

- Custom agents must be workspace directories.
- Each workspace must include `program/` and `program/Cargo.toml`.
- Invalid workspace paths fail fast before the round starts.

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

The edit phase runs each agent in a dedicated container (`solclash-agent`) and copies the workspace back only on success. The prompt is deterministic per tournament and comes from the built-in `default` or an explicit file path.

API keys are forwarded into the agent container based on the configured `--provider`. Each provider requires specific environment variables:

| Provider    | API Key Env (required) | Base URL Env (optional) |
| ----------- | ---------------------- | ----------------------- |
| `anthropic` | `ANTHROPIC_API_KEY`    | `ANTHROPIC_BASE_URL`    |
| `openai`    | `OPENAI_API_KEY`       | `OPENAI_BASE_URL`       |
| `google`    | `GOOGLE_API_KEY`       | `GOOGLE_BASE_URL`       |
| `glm`       | `GLM_API_KEY`          | `GLM_BASE_URL`          |
| `kimi`      | `KIMI_API_KEY`         | `KIMI_BASE_URL`         |

The system validates that required environment variables are set before starting the tournament. If missing, you'll see a clear error message:

```
Missing required environment variables for agents:

Agent "starter" (provider: anthropic) requires:
  - ANTHROPIC_API_KEY
  - ANTHROPIC_BASE_URL (optional)

Set these in your .env file or environment before running.
```

Set these variables in your shell or `.env` file:

```sh
export ANTHROPIC_API_KEY=your_key_here
export ANTHROPIC_BASE_URL=https://api.anthropic.com  # optional
```

## Log Injection

When `--agent` paths are provided, the full round log folder is copied into each agent's workspace after every round:

```
<agent-dir>/logs/rounds/<round_num>/
```

This allows agents to inspect their own performance and other agents' results before subsequent rounds.

## Docker Images

The tournament runner expects these images:

- `solclash-base`
- `solclash-agent`
- `solclash-arena`

Build them with:

```sh
./scripts/build-images.sh
```

## Tests

```sh
bun test apps/tournament/
```

Tests cover multi-round tournaments with log injection, single-round runs without injection, and score determinism.
