import {
  aggregateRound,
  runWindow,
  type AgentPolicy,
  type ArenaConfigResolved,
  type OhlcvBar,
  type RoundMetrics,
  type WindowMetrics,
  type WindowSummary,
} from "@solclash/simulator";
import type { Agent } from "../index.js";
import {
  buildWindows,
  collectInvalidBars,
  getWindowInvalidReason,
  selectWindows,
  sliceBars,
} from "@solclash/data";
import {
  closeLogSinks,
  writeRoundResults,
  writeSummary,
  writeWindowLogs,
  type RoundMeta,
} from "./logger.js";

export interface RunResult {
  round_metrics: Record<string, RoundMetrics>;
  summaries: WindowSummary[];
}

const EMPTY_METRICS = (window_id: string): WindowMetrics => ({
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

function getOrThrow<T>(
  record: Record<string, T>,
  key: string,
  context: string,
): T {
  const value = record[key];
  if (value === undefined) throw new Error(`${context}: missing key "${key}"`);
  return value;
}

export function deriveRoundMeta(
  roundStart: number,
  roundEnd: number,
  roundMetrics: Record<string, RoundMetrics>,
  invalidAgents: Record<string, string>,
): RoundMeta {
  const scores: Record<string, number> = {};
  for (const [agentId, metrics] of Object.entries(roundMetrics)) {
    scores[agentId] = metrics.score;
  }
  for (const agentId of Object.keys(invalidAgents)) {
    if (!(agentId in scores)) scores[agentId] = 0;
  }

  let winner: string | null = null;
  let bestScore = -Infinity;
  for (const [agentId, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      winner = agentId;
    }
  }

  return {
    round_start_ts: roundStart,
    round_end_ts: roundEnd,
    winner,
    scores,
    invalid_agents: invalidAgents,
  };
}

export async function executeRound(
  config: ArenaConfigResolved,
  bars: OhlcvBar[],
  agents: Agent[],
  outputDir: string,
): Promise<RunResult> {
  const { errors } = collectInvalidBars(
    bars,
    config.bar_interval_seconds * 1000,
  );
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

  const windows = selectWindows(
    validWindows,
    bars,
    {
      ...config.window_sampling,
      seed: config.window_sampling.seed ?? config.arena_id,
    },
    config.number_of_windows_per_round,
  );

  const summaries: WindowSummary[] = [];
  const agentWindowMetrics: Record<string, WindowMetrics[]> = {};
  for (const agent of agents) agentWindowMetrics[agent.id] = [];

  try {
    for (const windowDef of windows) {
      const invalidReason = getWindowInvalidReason(windowDef, errors);
      if (invalidReason) {
        const metricsByAgent: Record<string, WindowMetrics> = {};
        for (const agent of agents)
          metricsByAgent[agent.id] = EMPTY_METRICS(windowDef.window_id);
        summaries.push({
          window_id: windowDef.window_id,
          metrics_by_agent: metricsByAgent,
          invalid_window_reason: invalidReason,
        });
        continue;
      }

      const result = await runWindow(
        config,
        sliceBars(bars, windowDef),
        windowDef.window_id,
        agents.map<AgentPolicy>((agent) => ({
          id: agent.id,
          policy: agent.policy,
        })),
      );

      const metricsByAgent: Record<string, WindowMetrics> = {};
      for (const agent of agents) {
        const agentResult = getOrThrow(
          result.agent_results,
          agent.id,
          "runWindow result",
        );
        getOrThrow(agentWindowMetrics, agent.id, "agent window metrics").push(
          agentResult.metrics,
        );
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
