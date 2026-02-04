# @solclash/arena

CLI orchestrator for running SolClash simulation rounds.

## Usage

```sh
bun run apps/arena/src/cli.ts \
  --config arena-config.json \
  --data bars.json \
  --output ./output \
  --agent ./agents/team-a/solclash-agent.json
```

Or via the root script:

```sh
bun run arena -- --config arena-config.json --data bars.json
```

### Options

| Flag        | Short | Required | Description                                                                                |
| ----------- | ----- | -------- | ------------------------------------------------------------------------------------------ |
| `--config`  | `-c`  | Yes      | Path to arena config JSON (validated with Zod)                                             |
| `--data`    | `-d`  | No       | Path to bar data (`.json` array or `.jsonl`). Optional if `tape_source` is set in config.  |
| `--output`  | `-o`  | No       | Output directory (default: `./output`)                                                     |
| `--agent`   | `-a`  | No       | Paths to agent manifest JSON files (`solclash-agent.json`, repeatable)                     |
| `--harness` |       | No       | Path to the harness binary (default: `apps/arena-harness/target/release/solclash-harness`) |

Baseline agents listed in `config.baseline_bots_enabled` are loaded automatically.
Custom agents come from manifest files.

This CLI is also invoked inside the tournament arena container (`solclash-arena`).

### Scoring Weights

The `scoring_weights_reference` config field supports bare preset IDs (e.g. `"v1"`) which resolve to `docs/scoring-weights/v1.json`, as well as explicit paths. If `scoring_weights` is provided inline, the reference is ignored.

### Agent Manifest

Each `--agent` entry must point to a JSON manifest:

```json
{
  "id": "team-a",
  "arena_id": "btc-perp-v1",
  "provider": "anthropic",
  "workspace": "./workspace",
  "model": "claude-sonnet-4-20250514"
}
```

- `id`, `arena_id`, `provider`, and `workspace` are required.
- `workspace` is resolved relative to the manifest file path.
- `arena_id` must match `arena-config.json` `arena_id`.
- `provider` is required for tournament edit-phase routing.

## Output

The arena writes logs to the output directory:

```
output/
├── summary.json              # Per-window metrics summaries
├── round_results.json        # Per-agent round scores
├── round_meta.json           # Winner, scores, invalid agents (zero score), timestamps
├── BUY_AND_HOLD/
│   ├── policy_log.jsonl      # Agent actions per step
│   ├── trade_log.jsonl       # Executed trades
│   ├── equity_log.jsonl      # Per-step equity snapshots
│   └── liquidation_log.jsonl # Liquidation events (if any)
└── FLAT/
    ├── policy_log.jsonl
    └── equity_log.jsonl
```

## Pipeline

1. **Config** — Loads and validates `ArenaConfig` via Zod schema
2. **Data** — Loads bars via tape source or `--data`, validates integrity
3. **Windowing** — Builds window definitions from config
4. **Agents** — Resolves built-in baselines + custom Rust workspaces
5. **Simulation** — Runs all agents per window via `runWindow()`
6. **Aggregation** — Computes per-agent round metrics and scores
7. **Logging** — Writes JSONL logs and summary files

## On-Chain Agents

Run Rust policy programs compiled to SBF and executed via the harness:

```sh
bun run arena -- --config arena-config.json --data bars.json \
  --agent ./agents/agent-a/solclash-agent.json \
  --agent ./agents/agent-b/solclash-agent.json \
  --harness ./apps/arena-harness/target/release/solclash-harness
```

Each manifest workspace must satisfy the selected arena contract:

- include `program/` and `program/src/`
- include `program/Cargo.toml`
- build with `cargo build-sbf`
- produce `program/target/deploy/solclash_policy.so`

Invalid manifest/workspace paths fail fast.

Validation failures are recorded in `round_meta.json` under `invalid_agents`,
and invalid agents receive a score of 0 for the round.

## Migration (Breaking)

Old:

```sh
--agent ./workspace-dir
```

New:

```sh
--agent ./path/to/solclash-agent.json
```

## Tests

```sh
bun test apps/arena/
```

Optional E2E tests (baseline + on-chain) are gated behind `E2E_TESTS=1`.
On-chain E2E requires the Solana toolchain (`cargo build-sbf`) to be installed.

```sh
E2E_TESTS=1 bun test apps/arena/src/__tests__/e2e.test.ts
E2E_TESTS=1 bun test apps/arena/src/__tests__/onchain.e2e.test.ts
```
