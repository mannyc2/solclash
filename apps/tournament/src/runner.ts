import { $ } from "bun";
import { join } from "node:path";
import type { ArenaConfigResolved, OhlcvBar } from "@solclash/simulator";
import {
  executeRound,
  writeRoundMeta,
  type Agent,
  type RoundMeta,
} from "@solclash/arena";
import { injectLogs } from "./inject.js";
import { runEditPhase } from "./edit/runner.js";
import type { EditConfig } from "./edit/types.js";
import type { ContainerRuntime } from "./runtime/container.js";
import { runCompetitionInContainer } from "./competition/container.js";

export type AgentProvider = "anthropic" | "openai" | "google" | "glm" | "kimi";

export interface AgentSource {
  id: string;
  provider: AgentProvider | "builtin";
  workspace?: string;
  entrypoint?: string;
}

const PROVIDER_ENV_DEFAULTS: Record<
  AgentProvider,
  { api_key_env: string; base_url_env: string }
> = {
  anthropic: {
    api_key_env: "ANTHROPIC_API_KEY",
    base_url_env: "ANTHROPIC_BASE_URL",
  },
  openai: { api_key_env: "OPENAI_API_KEY", base_url_env: "OPENAI_BASE_URL" },
  google: { api_key_env: "GOOGLE_API_KEY", base_url_env: "GOOGLE_BASE_URL" },
  glm: { api_key_env: "GLM_API_KEY", base_url_env: "GLM_BASE_URL" },
  kimi: { api_key_env: "KIMI_API_KEY", base_url_env: "KIMI_BASE_URL" },
};

export function getProviderEnvDefaults(provider: AgentProvider): {
  api_key_env: string;
  base_url_env: string;
} {
  return PROVIDER_ENV_DEFAULTS[provider];
}

export function validateAgentEnvironment(agents: AgentSource[]): void {
  const missingCredentials: Array<{
    agentId: string;
    provider: string;
    missing: string[];
  }> = [];

  for (const agent of agents) {
    if (agent.provider === "builtin") {
      continue; // Builtin agents don't need API keys
    }

    const providerDefaults = getProviderEnvDefaults(agent.provider);
    const missing: string[] = [];

    // API key is required
    if (!process.env[providerDefaults.api_key_env]) {
      missing.push(providerDefaults.api_key_env);
    }

    if (missing.length > 0) {
      missingCredentials.push({
        agentId: agent.id,
        provider: agent.provider,
        missing,
      });
    }
  }

  if (missingCredentials.length > 0) {
    const errorLines = [
      "Missing required environment variables for agents:",
      "",
    ];

    for (const { agentId, provider, missing } of missingCredentials) {
      errorLines.push(`Agent "${agentId}" (provider: ${provider}) requires:`);
      for (const envVar of missing) {
        errorLines.push(`  - ${envVar}`);
      }
      const providerDefaults = getProviderEnvDefaults(
        provider as AgentProvider,
      );
      errorLines.push(`  - ${providerDefaults.base_url_env} (optional)`);
      errorLines.push("");
    }

    errorLines.push(
      "Set these in your .env file or environment before running.",
    );

    throw new Error(errorLines.join("\n"));
  }
}

export interface TournamentOpts {
  config: ArenaConfigResolved;
  bars: OhlcvBar[];
  agents?: Agent[];
  agentSources?: AgentSource[];
  rounds: number;
  outputDir: string;
  /** Directories to copy each round's logs into. */
  injectTargets?: string[];
  edit?: EditConfig;
  runtime?: ContainerRuntime;
  arenaImage?: string;
  competitionMode?: "container" | "local";
}

export interface TournamentResult {
  rounds: Array<{ round_num: number; meta: RoundMeta | null }>;
}

export async function runTournament(
  opts: TournamentOpts,
): Promise<TournamentResult> {
  const {
    config,
    bars,
    agents = [],
    agentSources = [],
    rounds,
    outputDir,
    injectTargets = [],
    edit,
    runtime,
    arenaImage = "solclash-arena",
    competitionMode,
  } = opts;

  const resolvedCompetitionMode =
    competitionMode ?? (runtime ? "container" : "local");
  const useContainerCompetition = resolvedCompetitionMode === "container";
  const editConfig = edit?.enabled ? edit : null;

  if (editConfig && !runtime) {
    throw new Error("Edit phase requires a container runtime");
  }

  if (useContainerCompetition && !runtime) {
    throw new Error("Container competition requires a container runtime");
  }

  // Validate environment variables before starting edit phase
  if (editConfig && agentSources.length > 0) {
    validateAgentEnvironment(agentSources);
  }

  const promptRef = editConfig?.prompt_ref ?? null;

  const roundRoot = join(outputDir, "rounds");
  await $`mkdir -p ${roundRoot}`.quiet();

  const collected: TournamentResult["rounds"] = [];

  for (let round = 1; round <= rounds; round++) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Round ${round}/${rounds}`);
    console.log("=".repeat(60));

    const roundDir = join(roundRoot, `${round}`);
    await $`mkdir -p ${roundDir}`.quiet();

    if (editConfig && promptRef && runtime) {
      await runEditPhase({
        round,
        agents: agentSources,
        config: editConfig,
        prompt_ref: promptRef,
        runtime,
        logsRoot: outputDir,
      });
    }

    let meta: RoundMeta | null = null;

    if (useContainerCompetition && runtime) {
      meta = await runCompetitionInContainer({
        round,
        config,
        bars,
        outputDir,
        agentSources,
        runtime,
        image: arenaImage,
      });
    } else {
      const roundStart = Date.now();
      const result = await executeRound(config, bars, agents, roundDir);
      const roundEnd = Date.now();

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

      meta = {
        round_start_ts: roundStart,
        round_end_ts: roundEnd,
        winner,
        scores,
        invalid_agents: {},
      };

      await writeRoundMeta(roundDir, meta);
    }

    collected.push({ round_num: round, meta });

    if (meta.winner) {
      console.log(
        `\nRound ${round} Winner: ${meta.winner} (score: ${meta.scores[meta.winner]?.toFixed(2) ?? "N/A"})`,
      );
    }

    if (injectTargets.length > 0) {
      await injectLogs(roundDir, round, injectTargets);
    }
  }

  // Write tournament-level summary.
  const agentIds =
    agentSources.length > 0
      ? agentSources.map((agent) => agent.id)
      : agents.map((agent) => agent.id);

  await Bun.write(
    join(outputDir, "tournament.json"),
    JSON.stringify(
      {
        config,
        agents: agentIds,
        rounds: collected,
        edit: editConfig
          ? {
              ...editConfig,
              prompt_ref: editConfig.prompt_ref,
            }
          : null,
      },
      null,
      2,
    ),
  );

  return { rounds: collected };
}
