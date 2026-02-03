import { $ } from "bun";
import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import type { ArenaConfigResolved, OhlcvBar } from "@solclash/simulator";
import { getBuiltinAgent, type Agent } from "@solclash/arena";
import { runTournament } from "../runner.js";

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

const config: ArenaConfigResolved = {
  arena_id: "tournament-e2e-test",
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

describe("tournament e2e", () => {
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

  test("runs 2-round tournament with log injection", async () => {
    const bars = makeFixtureBars(20);
    const momentumPolicy = (
      await import("../../../arena/src/__tests__/fixtures/momentum-agent.js")
    ).default;

    const agents: Agent[] = [
      { id: "MOMENTUM", policy: momentumPolicy },
      getBuiltinAgent("BUY_AND_HOLD")!,
      getBuiltinAgent("FLAT")!,
    ];

    const tmpDir = await makeTmpDir();
    const agentDir = await makeTmpDir();
    const agentDir2 = await makeTmpDir();

    const result = await runTournament({
      config,
      bars,
      agents,
      rounds: 2,
      outputDir: tmpDir,
      injectTargets: [agentDir, agentDir2],
    });

    // Assert tournament structure
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0]!.meta).not.toBeNull();
    expect(result.rounds[1]!.meta).not.toBeNull();

    // Assert round logs exist
    expect(await Bun.file(join(tmpDir, "rounds/1/summary.json")).exists()).toBe(
      true,
    );
    expect(await Bun.file(join(tmpDir, "rounds/2/summary.json")).exists()).toBe(
      true,
    );
    expect(await Bun.file(join(tmpDir, "tournament.json")).exists()).toBe(true);

    // Assert log injection happened for both targets
    for (const dir of [agentDir, agentDir2]) {
      expect(
        await Bun.file(join(dir, "logs/rounds/1/summary.json")).exists(),
      ).toBe(true);
      expect(
        await Bun.file(join(dir, "logs/rounds/2/summary.json")).exists(),
      ).toBe(true);
    }

    // Assert scores differ across agents
    const r1 = result.rounds[0]!.meta!;
    expect(r1.scores["MOMENTUM"]).not.toBe(r1.scores["FLAT"]);
    expect(r1.winner).toBeDefined();

    // Assert determinism: both rounds produce identical scores (same config + bars)
    const r2 = result.rounds[1]!.meta!;
    expect(r2.scores["MOMENTUM"]).toBe(r1.scores["MOMENTUM"]);
    expect(r2.scores["BUY_AND_HOLD"]).toBe(r1.scores["BUY_AND_HOLD"]);
    expect(r2.scores["FLAT"]).toBe(r1.scores["FLAT"]);

    // ── tournament.json content matches return value ──
    const tournamentJson = await Bun.file(
      join(tmpDir, "tournament.json"),
    ).json();
    expect(tournamentJson.rounds).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const diskRound = tournamentJson.rounds[i];
      const memRound = result.rounds[i]!;
      expect(diskRound.round_num).toBe(memRound.round_num);
      expect(diskRound.meta.winner).toBe(memRound.meta!.winner);
      expect(diskRound.meta.scores).toEqual(memRound.meta!.scores);
    }

    // ── round_meta.json exists and matches per round ──
    for (let round = 1; round <= 2; round++) {
      const roundDir = join(tmpDir, `rounds/${round}`);
      const metaFile = Bun.file(join(roundDir, "round_meta.json"));
      expect(await metaFile.exists()).toBe(true);
      const diskMeta = await metaFile.json();
      const memMeta = result.rounds[round - 1]!.meta!;
      expect(diskMeta.winner).toBe(memMeta.winner);
      expect(diskMeta.scores).toEqual(memMeta.scores);
      expect(diskMeta.round_start_ts).toBe(memMeta.round_start_ts);
      expect(diskMeta.round_end_ts).toBe(memMeta.round_end_ts);
    }

    // ── round_results.json exists per round ──
    for (let round = 1; round <= 2; round++) {
      expect(
        await Bun.file(
          join(tmpDir, `rounds/${round}/round_results.json`),
        ).exists(),
      ).toBe(true);
    }

    // ── Per-agent log dirs exist (MOMENTUM trades, so it must have logs) ──
    expect(
      await Bun.file(
        join(tmpDir, "rounds/1/MOMENTUM/policy_log.jsonl"),
      ).exists(),
    ).toBe(true);

    // ── Winner is highest scorer ──
    for (const meta of [r1, r2]) {
      const maxScore = Math.max(...Object.values(meta.scores));
      const expectedWinner = Object.entries(meta.scores).find(
        ([, s]) => s === maxScore,
      )![0];
      expect(meta.winner).toBe(expectedWinner);
    }

    // ── Injected content matches source ──
    for (let round = 1; round <= 2; round++) {
      const srcContent = await Bun.file(
        join(tmpDir, `rounds/${round}/summary.json`),
      ).text();
      for (const dir of [agentDir, agentDir2]) {
        const injectedContent = await Bun.file(
          join(dir, `logs/rounds/${round}/summary.json`),
        ).text();
        expect(injectedContent).toBe(srcContent);
      }
    }
  });

  test("runs tournament without inject targets", async () => {
    const bars = makeFixtureBars(20);
    const momentumPolicy = (
      await import("../../../arena/src/__tests__/fixtures/momentum-agent.js")
    ).default;

    const agents: Agent[] = [
      { id: "MOMENTUM", policy: momentumPolicy },
      getBuiltinAgent("BUY_AND_HOLD")!,
    ];

    const tmpDir = await makeTmpDir();

    const result = await runTournament({
      config,
      bars,
      agents,
      rounds: 1,
      outputDir: tmpDir,
    });

    // Round completes successfully
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]!.meta).not.toBeNull();
    expect(result.rounds[0]!.meta!.winner).toBeDefined();

    // tournament.json written
    expect(await Bun.file(join(tmpDir, "tournament.json")).exists()).toBe(true);

    // No logs/ directory was created in the output dir
    const logsDir = join(tmpDir, "logs");
    const logsDirExists = (
      await $`test -d ${logsDir} && echo yes || echo no`.text()
    ).trim();
    expect(logsDirExists).toBe("no");
  });
});
