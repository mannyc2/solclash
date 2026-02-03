import { $ } from "bun";
import { join } from "node:path";
import type {
  ArenaConfigResolved,
  OhlcvBar,
} from "@solclash/simulator";
import {
  executeRound,
  writeRoundMeta,
  type Agent,
  type RoundMeta,
} from "@solclash/arena";
import { injectLogs } from "./inject.js";

export interface TournamentOpts {
  config: ArenaConfigResolved;
  bars: OhlcvBar[];
  agents: Agent[];
  rounds: number;
  outputDir: string;
  /** Directories to copy each round's logs into. */
  injectTargets?: string[];
}

export interface TournamentResult {
  rounds: Array<{ round_num: number; meta: RoundMeta | null }>;
}

export async function runTournament(
  opts: TournamentOpts,
): Promise<TournamentResult> {
  const { config, bars, agents, rounds, outputDir, injectTargets = [] } = opts;

  const roundRoot = join(outputDir, "rounds");
  await $`mkdir -p ${roundRoot}`.quiet();

  const collected: TournamentResult["rounds"] = [];

  for (let round = 1; round <= rounds; round++) {
    const roundDir = join(roundRoot, `${round}`);
    await $`mkdir -p ${roundDir}`.quiet();

    const roundStart = Date.now();
    const result = await executeRound(config, bars, agents, roundDir);
    const roundEnd = Date.now();

    // Build scores map including all agents.
    const scores: Record<string, number> = {};
    for (const [agentId, metrics] of Object.entries(result.round_metrics)) {
      scores[agentId] = metrics.score;
    }

    let winner: string | null = null;
    let bestScore = -Infinity;
    for (const [agentId, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        winner = agentId;
      }
    }

    const meta: RoundMeta = {
      round_start_ts: roundStart,
      round_end_ts: roundEnd,
      winner,
      scores,
      invalid_agents: {},
    };

    await writeRoundMeta(roundDir, meta);
    collected.push({ round_num: round, meta });

    if (injectTargets.length > 0) {
      await injectLogs(roundDir, round, injectTargets);
    }
  }

  // Write tournament-level summary.
  await Bun.write(
    join(outputDir, "tournament.json"),
    JSON.stringify(
      {
        config,
        agents: agents.map((agent) => agent.id),
        rounds: collected,
      },
      null,
      2,
    ),
  );

  return { rounds: collected };
}
