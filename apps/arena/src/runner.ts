import type {
  ArenaConfigResolved,
  OhlcvBar,
  WindowMetrics,
  WindowSummary,
  RoundMetrics,
  AgentPolicy,
} from "@solclash/simulator";
import { runWindow, aggregateRound } from "@solclash/simulator";
import {
  collectInvalidBars,
  getWindowInvalidReason,
  buildWindows,
  sliceBars,
  selectWindows,
} from "@solclash/data";
import type { Agent } from "./agents.js";
import {
  writeWindowLogs,
  writeSummary,
  writeRoundResults,
  closeLogSinks,
} from "./logger.js";

export interface RunResult {
  round_metrics: Record<string, RoundMetrics>;
  summaries: WindowSummary[];
}

function getOrThrow<T>(
  record: Record<string, T>,
  key: string,
  context: string,
): T {
  const value = record[key];
  if (value === undefined) {
    throw new Error(`${context}: missing key "${key}"`);
  }
  return value;
}

export async function executeRound(
  config: ArenaConfigResolved,
  bars: OhlcvBar[],
  agents: Agent[],
  outputDir: string,
): Promise<RunResult> {
  // Validate bars
  const barIntervalMs = config.bar_interval_seconds * 1000;
  const { errors } = collectInvalidBars(bars, barIntervalMs);

  // Build windows
  const allWindows = buildWindows(
    bars,
    config.window_duration_bars,
    config.max_window_overlap_pct,
  );

  if (allWindows.length === 0) {
    throw new Error(
      `No valid windows: ${bars.length} bars < ${config.window_duration_bars} window_duration_bars`,
    );
  }

  const validWindows = allWindows.filter(
    (windowDef) => !getWindowInvalidReason(windowDef, errors),
  );

  if (validWindows.length === 0) {
    throw new Error("No valid windows after bar integrity checks");
  }

  if (validWindows.length < config.number_of_windows_per_round) {
    throw new Error(
      `Not enough valid windows (${validWindows.length}) for number_of_windows_per_round=${config.number_of_windows_per_round}`,
    );
  }

  // Select windows for this round
  const sampling = {
    ...config.window_sampling,
    // Default seed to arena_id to keep window selection deterministic across runs.
    seed: config.window_sampling.seed ?? config.arena_id,
  };
  const windows = selectWindows(
    validWindows,
    bars,
    sampling,
    config.number_of_windows_per_round,
  );

  const agentWindowMetrics: Record<string, WindowMetrics[]> = {};
  const summaries: WindowSummary[] = [];

  const makeEmptyMetrics = (window_id: string) => ({
    window_id,
    pnl: 0,
    drawdown: 0,
    exposure: 0,
    total_fees: 0,
    liquidation_count: 0,
    equity_start: 0,
    equity_end: 0,
    peak_equity: 0,
    trough_equity: 0,
  });

  for (const agent of agents) {
    agentWindowMetrics[agent.id] = [];
  }

  try {
    for (const windowDef of windows) {
      const invalidReason = getWindowInvalidReason(windowDef, errors);
      if (invalidReason) {
        // Exclude invalid windows from scoring while still reporting them in summaries.
        const metricsByAgent: Record<string, WindowMetrics> = {};
        for (const agent of agents) {
          metricsByAgent[agent.id] = makeEmptyMetrics(windowDef.window_id);
        }
        summaries.push({
          window_id: windowDef.window_id,
          metrics_by_agent: metricsByAgent,
          invalid_window_reason: invalidReason,
        });
        continue;
      }

      const windowBars = sliceBars(bars, windowDef);

      const policies: AgentPolicy[] = agents.map((agent) => ({
        id: agent.id,
        policy: agent.policy,
      }));
      const result = await runWindow(
        config,
        windowBars,
        windowDef.window_id,
        policies,
      );

      // Summary entries are per window, aggregating all agents into one record.
      const metricsByAgent: Record<string, WindowMetrics> = {};
      for (const agent of agents) {
        const agentResult = getOrThrow(
          result.agent_results,
          agent.id,
          "runWindow result",
        );
        const metrics = getOrThrow(
          agentWindowMetrics,
          agent.id,
          "agent window metrics",
        );
        metrics.push(agentResult.metrics);
        await writeWindowLogs(outputDir, agent.id, agentResult);
        metricsByAgent[agent.id] = agentResult.metrics;
      }
      summaries.push({
        window_id: windowDef.window_id,
        metrics_by_agent: metricsByAgent,
        invalid_window_reason: null,
      });
    }
  } finally {
    await closeLogSinks();
  }

  // Build round metrics per agent
  const roundMetrics: Record<string, RoundMetrics> = {};
  for (const agent of agents) {
    const metrics = getOrThrow(
      agentWindowMetrics,
      agent.id,
      "aggregateRound input",
    );
    roundMetrics[agent.id] = aggregateRound(metrics, config.scoring_weights);
  }

  await writeSummary(outputDir, summaries);
  await writeRoundResults(outputDir, roundMetrics);

  return { round_metrics: roundMetrics, summaries };
}
