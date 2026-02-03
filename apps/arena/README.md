# @solclash/arena

CLI orchestrator for running SolClash simulation rounds.

## Usage

```sh
bun run apps/arena/src/cli.ts \
  --config arena-config.json \
  --data bars.json \
  --output ./output \
  --agents ./my-agent.ts
```

Or via the root script:

```sh
bun run arena -- --config arena-config.json --data bars.json
```

### Options

| Flag | Short | Required | Description |
|------|-------|----------|-------------|
| `--config` | `-c` | Yes | Path to arena config JSON (validated with Zod) |
| `--data` | `-d` | No | Path to bar data (`.json` array or `.jsonl`). Optional if `tape_source` is set in config. |
| `--output` | `-o` | No | Output directory (default: `./output`) |
| `--agents` | `-a` | No | Paths to custom agent modules (repeatable) |
| `--onchain-agents` |  | No | Directories containing on-chain agent programs (repeatable) |
| `--harness` |  | No | Path to the harness binary (default: `apps/arena-harness/target/release/solclash-harness`) |

Baseline agents listed in `config.baseline_bots_enabled` are loaded automatically.

## Output

The arena writes logs to the output directory:

```
output/
├── summary.json              # Per-window metrics summaries
├── round_results.json        # Per-agent round scores
├── round_meta.json           # Winner, scores, invalid agents, timestamps
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
4. **Agents** — Resolves built-in baselines + custom agent modules
5. **Simulation** — Runs all agents per window via `runWindow()`
6. **Aggregation** — Computes per-agent round metrics and scores
7. **Logging** — Writes JSONL logs and summary files

## Custom Agents

Export a `PolicyFn` as the default export or as a named `policy` export:

```ts
// my-agent.ts
import { ActionType, type PolicyFn } from "@solclash/simulator";

const policy: PolicyFn = (input) => {
  const lastBar = input.ohlcv[input.ohlcv.length - 1];
  if (lastBar && lastBar.close > lastBar.open) {
    return { version: 1, action_type: ActionType.BUY, order_qty: 1, err_code: 0 };
  }
  return { version: 1, action_type: ActionType.HOLD, order_qty: 0, err_code: 0 };
};

export default policy;
```

Then pass it with `--agents ./my-agent.ts`.

## On-Chain Agents

Run Rust policy programs compiled to SBF and executed via the harness:

```sh
bun run arena -- --config arena-config.json --data bars.json \
  --onchain-agents ./agent-a ./agent-b \
  --harness ./apps/arena-harness/target/release/solclash-harness
```

Each on-chain agent directory must contain `program/` and build with
`cargo build-sbf`, producing `program/target/deploy/solclash_policy.so`.

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
