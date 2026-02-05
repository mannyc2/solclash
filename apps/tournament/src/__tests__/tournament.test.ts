import { $ } from "bun";
import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArenaConfigResolved, OhlcvBar } from "@solclash/simulator";
import { getBuiltinAgent, type Agent } from "@solclash/arenas";
import { runTournament, type AgentSource } from "../runner.js";
import { HostRuntime } from "../runtime/host.js";
import { buildEditConfig } from "../edit/config.js";
import { resolveEditPrompt } from "../edit/prompt.js";
import { runEditPhase } from "../edit/runner.js";

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

async function captureConsoleLogs<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; lines: string[] }> {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    console.log = originalLog;
  }
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
  const fakeRunnerPath = fileURLToPath(
    new URL("./fixtures/fake-edit-runner.mjs", import.meta.url),
  );

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
      await import("../../../../packages/arenas/src/__tests__/fixtures/momentum-agent.js")
    ).default;

    const agents: Agent[] = [
      { id: "MOMENTUM", policy: momentumPolicy },
      requireValue(
        getBuiltinAgent("btc-perp-v1", "BUY_AND_HOLD"),
        "BUY_AND_HOLD agent",
      ),
      requireValue(getBuiltinAgent("btc-perp-v1", "FLAT"), "FLAT agent"),
    ];

    const tmpDir = await makeTmpDir();
    const agentDir = await makeTmpDir();
    const agentDir2 = await makeTmpDir();

    const { result, lines } = await captureConsoleLogs(() =>
      runTournament({
        config,
        bars,
        agents,
        rounds: 2,
        outputDir: tmpDir,
        injectTargets: [agentDir, agentDir2],
      }),
    );

    // Assert tournament structure
    expect(result.rounds).toHaveLength(2);
    const round1 = requireValue(result.rounds[0], "round 1");
    const round2 = requireValue(result.rounds[1], "round 2");
    expect(round1.meta).not.toBeNull();
    expect(round2.meta).not.toBeNull();

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
    const r1 = requireValue(round1.meta, "round 1 meta");
    expect(r1.scores["BUY_AND_HOLD"]).not.toBe(r1.scores["FLAT"]);
    expect(r1.winner).toBeDefined();

    // Assert determinism: both rounds produce identical scores (same config + bars)
    const r2 = requireValue(round2.meta, "round 2 meta");
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
      const memRound = requireValue(result.rounds[i], `round ${i + 1}`);
      expect(diskRound.round_num).toBe(memRound.round_num);
      const memMeta = requireValue(memRound.meta, `round ${i + 1} meta`);
      expect(diskRound.meta.winner).toBe(memMeta.winner);
      expect(diskRound.meta.scores).toEqual(memMeta.scores);
    }

    // ── round_meta.json exists and matches per round ──
    for (let round = 1; round <= 2; round++) {
      const roundDir = join(tmpDir, `rounds/${round}`);
      const metaFile = Bun.file(join(roundDir, "round_meta.json"));
      expect(await metaFile.exists()).toBe(true);
      const diskMeta = await metaFile.json();
      const memRound = requireValue(result.rounds[round - 1], `round ${round}`);
      const memMeta = requireValue(memRound.meta, `round ${round} meta`);
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

    // ── snapshot_index.json exists and matches scores ──
    for (let round = 1; round <= 2; round++) {
      const snapshotIndex = await Bun.file(
        join(tmpDir, `rounds/${round}/snapshot_index.json`),
      ).json();
      expect(snapshotIndex.round).toBe(round);
      expect(snapshotIndex.snapshots_root).toBe(`rounds/${round}/workspaces`);
      const entries = snapshotIndex.agents;
      expect(entries).toHaveLength(3);
      const memRound = requireValue(result.rounds[round - 1], `round ${round}`);
      const memMeta = requireValue(memRound.meta, `round ${round} meta`);
      for (const entry of entries) {
        expect(entry.origin).toBe("policy");
        expect(entry.snapshot_path).toBeNull();
        expect(entry.score).toBe(memMeta.scores[entry.agent_id]);
      }
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
      );
      const expectedWinnerId = requireValue(expectedWinner, "winner entry")[0];
      expect(meta.winner).toBe(expectedWinnerId);
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

    // ── File write observability logs are emitted ──
    expect(lines.some((line) => line.includes("FILE_WRITE write"))).toBe(true);
  });

  test("runs tournament without inject targets", async () => {
    const bars = makeFixtureBars(20);
    const momentumPolicy = (
      await import("../../../../packages/arenas/src/__tests__/fixtures/momentum-agent.js")
    ).default;

    const agents: Agent[] = [
      { id: "MOMENTUM", policy: momentumPolicy },
      requireValue(
        getBuiltinAgent("btc-perp-v1", "BUY_AND_HOLD"),
        "BUY_AND_HOLD agent",
      ),
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
    const firstRound = requireValue(result.rounds[0], "round 1");
    const firstMeta = requireValue(firstRound.meta, "round 1 meta");
    expect(firstMeta).not.toBeNull();
    expect(firstMeta.winner).toBeDefined();

    // tournament.json written
    expect(await Bun.file(join(tmpDir, "tournament.json")).exists()).toBe(true);

    // snapshot index exists
    expect(
      await Bun.file(join(tmpDir, "rounds/1/snapshot_index.json")).exists(),
    ).toBe(true);

    // No logs/ directory was created in the output dir
    const logsDir = join(tmpDir, "logs");
    const logsDirExists = (
      await $`test -d ${logsDir} && echo yes || echo no`.text()
    ).trim();
    expect(logsDirExists).toBe("no");
  });

  test("edit phase isolates agent workspaces and applies edits", async () => {
    const runtime = new HostRuntime();
    const logsRoot = await makeTmpDir();
    const workspaceA = await makeTmpDir();
    const workspaceB = await makeTmpDir();

    await Bun.write(join(workspaceA, "agent.js"), "export default () => {}");
    await Bun.write(join(workspaceB, "agent.js"), "export default () => {}");

    const editConfig = buildEditConfig({
      enabled: true,
      prompt_ref: "default",
      runner_path: fakeRunnerPath,
      image: "host",
      concurrency: 2,
    });

    const { result: results, lines } = await captureConsoleLogs(() =>
      runEditPhase({
        round: 1,
        agents: [
          {
            id: "AGENT_A",
            provider: "anthropic",
            workspace: workspaceA,
          },
          {
            id: "AGENT_B",
            provider: "anthropic",
            workspace: workspaceB,
          },
        ],
        config: editConfig,
        prompt_ref: "default",
        runtime,
        logsRoot,
      }),
    );

    expect(results["AGENT_A"]?.status).toBe("success");
    expect(results["AGENT_B"]?.status).toBe("success");

    const markerA = (
      await Bun.file(join(workspaceA, "edit_marker.txt")).text()
    ).trim();
    const markerB = (
      await Bun.file(join(workspaceB, "edit_marker.txt")).text()
    ).trim();
    expect(markerA).toBe("edited:AGENT_A");
    expect(markerB).toBe("edited:AGENT_B");

    const promptA = resolveEditPrompt("default", 1, "AGENT_A");
    const promptB = resolveEditPrompt("default", 1, "AGENT_B");
    const metaA = await Bun.file(
      join(logsRoot, "edits/1/AGENT_A/edit_meta.json"),
    ).json();
    const metaB = await Bun.file(
      join(logsRoot, "edits/1/AGENT_B/edit_meta.json"),
    ).json();
    expect(metaA.prompt_sha256).toBe(promptA.sha256);
    expect(metaB.prompt_sha256).toBe(promptB.sha256);

    expect(lines.some((line) => line.includes("FILE_WRITE copy_to"))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes("FILE_WRITE copy_from"))).toBe(
      true,
    );
  });

  test("log injection occurs before the next edit phase", async () => {
    const runtime = new HostRuntime();
    const workspace = await makeTmpDir();
    await Bun.write(join(workspace, "agent.js"), "export default () => {}");

    const editConfig = buildEditConfig({
      enabled: true,
      prompt_ref: "default",
      runner_path: fakeRunnerPath,
      image: "host",
      concurrency: 1,
    });

    const agents: Agent[] = [
      requireValue(getBuiltinAgent("btc-perp-v1", "FLAT"), "FLAT agent"),
    ];
    const agentSources: AgentSource[] = [
      { id: "DUMMY", provider: "anthropic", workspace },
    ];

    const outputDir = await makeTmpDir();

    await runTournament({
      config,
      bars: makeFixtureBars(20),
      agents,
      agentSources,
      rounds: 2,
      outputDir,
      injectTargets: [workspace],
      edit: editConfig,
      runtime,
      competitionMode: "local",
    });

    const snapshotDir = join(
      outputDir,
      "rounds/1/workspaces/DUMMY/edit_marker.txt",
    );
    expect(await Bun.file(snapshotDir).exists()).toBe(true);

    const snapshotIndex = await Bun.file(
      join(outputDir, "rounds/1/snapshot_index.json"),
    ).json();
    const dummyEntry = snapshotIndex.agents.find(
      (entry: { agent_id: string }) => entry.agent_id === "DUMMY",
    );
    expect(dummyEntry).toBeDefined();
    expect(dummyEntry.origin).toBe("workspace");
    expect(dummyEntry.snapshot_path).toBe("rounds/1/workspaces/DUMMY");

    const seen = (
      await Bun.file(join(workspace, "log_seen.txt")).text()
    ).trim();
    expect(seen).toBe("seen:true");
  });
});
