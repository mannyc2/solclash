import { $, JSONL } from "bun";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { executeRound } from "../index.js";
import { getBuiltinAgent, type Agent } from "@solclash/agents";
import {
  ActionType,
  type ArenaConfigResolved,
  type OhlcvBar,
} from "@solclash/simulator";
import { join } from "node:path";

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
  arena_id: "e2e-test",
  symbol: "BTC-PERP",
  base_mint: "BTC",
  quote_mint: "USDC",
  bar_interval_seconds: 60,
  price_scale: 1_000_000,
  volume_scale: 1_000_000,
  tape_source: { type: "historical", dataset_id: "test" },
  window_duration_bars: 10,
  max_window_overlap_pct: 0,
  number_of_windows_per_round: 2,
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
};

describe("arena e2e", () => {
  const runE2E = Boolean(process.env["E2E_TESTS"]);
  let tmpDir = "";

  beforeAll(async () => {
    if (!runE2E) return;
    tmpDir = await $`mktemp -d`.text();
    tmpDir = tmpDir.trim();
  });

  afterAll(async () => {
    if (!runE2E) return;
    await $`rm -rf ${tmpDir}`.quiet();
  });

  const maybeTest = runE2E ? test : test.skip;

  test("custom momentum agent produces trades and outranks FLAT", async () => {
    const tmpDir2 = (await $`mktemp -d`.text()).trim();
    try {
      const bars = makeFixtureBars(20);
      const momentumPolicy = (await import("./fixtures/momentum-agent.js"))
        .default;
      const agents: Agent[] = [
        { id: "MOMENTUM", policy: momentumPolicy },
        requireValue(getBuiltinAgent("BUY_AND_HOLD"), "BUY_AND_HOLD agent"),
        requireValue(getBuiltinAgent("FLAT"), "FLAT agent"),
      ];

      const result = await executeRound(config, bars, agents, tmpDir2);

      const momentum = requireValue(
        result.round_metrics["MOMENTUM"],
        "MOMENTUM metrics",
      );
      const flat = requireValue(result.round_metrics["FLAT"], "FLAT metrics");
      const buyHold = requireValue(
        result.round_metrics["BUY_AND_HOLD"],
        "BUY_AND_HOLD metrics",
      );

      // MOMENTUM actively trades so it must have non-zero PnL
      expect(momentum.pnl_total).not.toBe(0);

      // MOMENTUM PnL differs from FLAT (which is always 0)
      expect(momentum.pnl_total).not.toBe(flat.pnl_total);

      // MOMENTUM PnL differs from BUY_AND_HOLD (buys every step vs once)
      expect(momentum.pnl_total).not.toBe(buyHold.pnl_total);

      // MOMENTUM has higher exposure than FLAT (it holds positions)
      expect(momentum.exposure_avg).toBeGreaterThan(flat.exposure_avg);

      // MOMENTUM score differs from FLAT
      expect(momentum.score).not.toBe(flat.score);

      // Trade log exists and has entries
      const tradeLogPath = join(tmpDir2, "MOMENTUM", "trade_log.jsonl");
      expect(await Bun.file(tradeLogPath).exists()).toBe(true);
      const tradeLogText = await Bun.file(tradeLogPath).text();
      const tradeEntries = JSONL.parse(tradeLogText);
      expect(tradeEntries.length).toBeGreaterThan(0);

      // Policy log contains BUY actions (fixture bars always close > open)
      const policyLogPath = join(tmpDir2, "MOMENTUM", "policy_log.jsonl");
      const policyLogText = await Bun.file(policyLogPath).text();
      const policyEntries = JSONL.parse(policyLogText);
      const buyEntries = policyEntries.filter((entry) => {
        if (typeof entry !== "object" || entry === null) {
          return false;
        }
        const actionType = (entry as { action_type?: unknown }).action_type;
        return actionType === ActionType.BUY;
      });
      expect(buyEntries.length).toBeGreaterThan(0);
    } finally {
      await $`rm -rf ${tmpDir2}`.quiet();
    }
  });

  maybeTest("runs baselines on fixture data and produces logs", async () => {
    const bars = makeFixtureBars(20);
    const agents: Agent[] = [
      requireValue(getBuiltinAgent("BUY_AND_HOLD"), "BUY_AND_HOLD agent"),
      requireValue(getBuiltinAgent("FLAT"), "FLAT agent"),
    ];

    const result = await executeRound(config, bars, agents, tmpDir);

    // Both agents have results
    expect(result.round_metrics["BUY_AND_HOLD"]).toBeDefined();
    expect(result.round_metrics["FLAT"]).toBeDefined();

    // FLAT should have 0 PnL
    const flatMetrics = requireValue(
      result.round_metrics["FLAT"],
      "FLAT metrics",
    );
    expect(flatMetrics.pnl_total).toBe(0);

    // BUY_AND_HOLD should have positive PnL (rising prices)
    const buyHoldMetrics = requireValue(
      result.round_metrics["BUY_AND_HOLD"],
      "BUY_AND_HOLD metrics",
    );
    expect(buyHoldMetrics.pnl_total).toBeGreaterThan(0);

    // Log files exist
    const summaryPath = join(tmpDir, "summary.json");
    expect(await Bun.file(summaryPath).exists()).toBe(true);
    expect(await Bun.file(join(tmpDir, "round_results.json")).exists()).toBe(
      true,
    );
    expect(
      await Bun.file(join(tmpDir, "BUY_AND_HOLD", "policy_log.jsonl")).exists(),
    ).toBe(true);

    const summaries = await Bun.file(summaryPath).json();
    expect(Array.isArray(summaries)).toBe(true);
    expect(summaries).toHaveLength(config.number_of_windows_per_round);
    const first = requireValue(summaries[0], "first summary");
    expect(first.metrics_by_agent).toBeDefined();
    expect(first.metrics_by_agent["BUY_AND_HOLD"]).toBeDefined();
    expect(first.metrics_by_agent["FLAT"]).toBeDefined();
  });
});
