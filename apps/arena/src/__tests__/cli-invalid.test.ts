import { $ } from "bun";
import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";

function makeFixtureBars(n: number) {
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

describe("arena cli invalid agents", () => {
  const tmpDirs: string[] = [];

  async function makeTmpDir(): Promise<string> {
    const dir = (await $`mktemp -d`.text()).trim();
    tmpDirs.push(dir);
    return dir;
  }

  afterAll(async () => {
    for (const dir of tmpDirs) {
      await $`rm -rf ${dir}`.quiet();
    }
  });

  test("fails fast when a custom agent path is not a valid on-chain workspace", async () => {
    const tmpDir = await makeTmpDir();
    const outDir = join(tmpDir, "out");
    const badAgentDir = join(tmpDir, "bad-agent");
    const configPath = join(tmpDir, "arena-config.json");
    const barsPath = join(tmpDir, "bars.json");

    await $`mkdir -p ${badAgentDir}`.quiet();
    await Bun.write(barsPath, JSON.stringify(makeFixtureBars(20), null, 2));
    await Bun.write(
      configPath,
      JSON.stringify(
        {
          arena_id: "cli-invalid-test",
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
          baseline_bots_enabled: ["FLAT"],
        },
        null,
        2,
      ),
    );

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "apps/arena/src/cli.ts",
        "--config",
        configPath,
        "--data",
        barsPath,
        "--output",
        outDir,
        "--agent",
        badAgentDir,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Invalid on-chain agent workspace");
    expect(stderr).toContain("missing program/ directory");
    expect(await Bun.file(join(outDir, "round_meta.json")).exists()).toBe(
      false,
    );
  });
});
