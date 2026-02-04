import { $ } from "bun";
import { describe, test, expect } from "bun:test";
import { executeRound } from "../runner.js";
import type { Agent } from "../agents.js";
import { HarnessClient } from "../harness.js";
import type {
  ArenaConfigResolved,
  OhlcvBar,
  PolicyFn,
} from "@solclash/simulator";
import { join, resolve } from "node:path";

function makeFixtureBars(n: number): OhlcvBar[] {
  const basePrice = 50000;
  return Array.from({ length: n }, (_, i) => {
    const price = basePrice + i * 10;
    return {
      symbol: "BTC-PERP",
      bar_start_ts_ms: i * 60000,
      bar_end_ts_ms: (i + 1) * 60000,
      open: price,
      high: price + 5,
      low: price - 5,
      close: price + 2,
      volume: 100,
    };
  });
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

const config: ArenaConfigResolved = {
  arena_id: "onchain-e2e-test",
  symbol: "BTC-PERP",
  base_mint: "BTC",
  quote_mint: "USDC",
  bar_interval_seconds: 60,
  price_scale: 1_000_000,
  volume_scale: 1_000_000,
  tape_source: { type: "historical", dataset_id: "test" },
  window_duration_bars: 10,
  max_window_overlap_pct: 0,
  number_of_windows_per_round: 1,
  window_sampling: {
    mode: "sequential",
    stress_count: 1,
    buckets: { volatility: 3, trend: 3, volume: 3 },
  },
  lookback_len: 5,
  slippage_bps: 5,
  impact_k_bps: 0,
  impact_cap_bps: 50,
  liquidity_multiplier: 1.0,
  min_liquidity: 1,
  taker_fee_bps: 5,
  initial_margin_bps: 1000,
  maintenance_margin_bps: 500,
  max_leverage_bps: 10000,
  liquidation_fee_bps: 50,
  funding_rate_bps_per_bar: 0,
  initial_balances: [{ mint: "USDC", amount: 10000 }],
  scoring_weights: { pnl: 1, drawdown: -0.5, exposure: -0.1 },
  scoring_weights_reference: "docs/scoring-weights.json",
  baseline_bots_enabled: [],
  compute_unit_limit: 200000,
};

describe("arena on-chain e2e", () => {
  const runE2E = Boolean(process.env["E2E_TESTS"]);

  const maybeTest = runE2E ? test : test.skip;
  const timeoutMs = 60000;

  maybeTest(
    "runs starter program via harness and produces logs",
    async () => {
      let tmpDir = "";
      let harness: HarnessClient | null = null;

      try {
        tmpDir = (await $`mktemp -d`.text()).trim();

        await $`cargo build --manifest-path apps/arena-harness/Cargo.toml`;
        await $`cargo build-sbf`.cwd(
          "packages/arenas/arenas/btc-perp-v1/starter/program",
        );

        const harnessPath = resolve(
          process.cwd(),
          "apps/arena-harness/target/debug/solclash-harness",
        );
        const soPath = resolve(
          process.cwd(),
          "packages/arenas/arenas/btc-perp-v1/starter/program/target/deploy/solclash_policy.so",
        );

        harness = await HarnessClient.start(
          harnessPath,
          [{ id: "starter", so_path: soPath }],
          config.compute_unit_limit,
        );

        const bars = makeFixtureBars(20);

        const policy: PolicyFn = async (input) => {
          if (!harness) {
            throw new Error("Harness not initialized");
          }
          return harness.eval("starter", input);
        };

        const agents: Agent[] = [{ id: "starter", policy }];

        const result = await executeRound(config, bars, agents, tmpDir);

        expect(result.round_metrics["starter"]).toBeDefined();
        const starterMetrics = requireValue(
          result.round_metrics["starter"],
          "starter metrics",
        );
        expect(starterMetrics.pnl_total).toBe(0);
        expect(await Bun.file(join(tmpDir, "summary.json")).exists()).toBe(
          true,
        );
        expect(
          await Bun.file(join(tmpDir, "round_results.json")).exists(),
        ).toBe(true);
        expect(
          await Bun.file(join(tmpDir, "starter", "policy_log.jsonl")).exists(),
        ).toBe(true);
      } finally {
        if (harness) {
          await harness.shutdown();
        }
        if (tmpDir) {
          await $`rm -rf ${tmpDir}`.quiet();
        }
      }
    },
    { timeout: timeoutMs },
  );
});
