/**
 * Tournament orchestrator.
 *
 * A tournament is N rounds of: edit → compete → score.
 *
 * 1. EDIT PHASE (optional) — Each non-builtin agent gets a sandboxed Claude
 *    Code session to modify its own Solana program source. The agent sees its
 *    previous round's logs so it can learn from mistakes. (See edit/runner.ts.)
 *
 * 2. COMPETITION PHASE — All agents (builtin baseline bots + workspace agents
 *    with compiled programs) are fed the same OHLCV bar data and scored on
 *    PnL, drawdown, and exposure via the simulator engine.
 *    - "local" mode: runs the simulator in-process (fast, no Docker)
 *    - "container" mode: runs the arena CLI inside Docker (isolated, reproducible)
 *
 * 3. After each round, logs are optionally "injected" (copied) into each
 *    agent's workspace so the next edit phase can see what happened.
 *
 * The CLI (cli.ts) handles arg parsing and setup; this file owns the loop.
 */
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { ArenaConfigResolved, OhlcvBar } from "@solclash/simulator";
import type { Agent, AgentProvider } from "@solclash/arenas";
import {
  buildPolicies,
  deriveRoundMeta,
  executeRound,
  HarnessClient,
  prepareProgramsAndInvalidAgents,
  validateWorkspaceForArena,
  writeRoundMeta,
  type OnchainWorkspaceAgent,
  type RoundMeta,
} from "@solclash/arenas";
import { runEditPhase } from "./edit/runner.js";
import type { EditConfig } from "./edit/config.js";
import type { ContainerRuntime } from "./runtime/container.js";
import { runCompetitionInContainer } from "./competition/container.js";

/** Copy a round's result logs into each agent's workspace so the next edit phase can read them. */
async function injectLogs(
  roundDir: string,
  roundNum: number,
  targets: string[],
): Promise<void> {
  for (const target of targets) {
    const dest = join(target, "logs", "rounds", `${roundNum}`);
    await mkdir(dest, { recursive: true });
    await cp(roundDir, dest, { recursive: true });
  }
}

const DEFAULT_SNAPSHOT_EXCLUDES = new Set([
  "logs",
  "target",
  ".git",
  "node_modules",
  "dist",
  "build",
  ".cache",
  "tmp",
]);

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

async function copyDirFiltered(
  src: string,
  dest: string,
  excludes: Set<string>,
): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (excludes.has(entry.name)) continue;
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirFiltered(srcPath, destPath, excludes);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      await cp(srcPath, destPath, { dereference: false });
    }
  }
}

async function snapshotWorkspaces(
  roundDir: string,
  outputDir: string,
  agentSources: AgentSource[],
): Promise<Map<string, string>> {
  const snapshotsRoot = join(roundDir, "workspaces");
  const snapshotPaths = new Map<string, string>();
  const workspaceAgents = agentSources.filter(
    (agent): agent is AgentSource & { workspace: string } =>
      agent.provider !== "builtin" && typeof agent.workspace === "string",
  );
  await mkdir(snapshotsRoot, { recursive: true });
  if (workspaceAgents.length === 0) {
    return snapshotPaths;
  }
  for (const agent of workspaceAgents) {
    const dest = join(snapshotsRoot, agent.id);
    await rm(dest, { recursive: true, force: true });
    await copyDirFiltered(agent.workspace, dest, DEFAULT_SNAPSHOT_EXCLUDES);
    snapshotPaths.set(agent.id, toPosixPath(relative(outputDir, dest)));
  }
  return snapshotPaths;
}

/**
 * Lightweight agent descriptor used throughout the tournament.
 * Builtin agents (baseline bots like MOMENTUM, FLAT) have no workspace.
 * Workspace agents have a local directory with Solana program source that
 * gets compiled and loaded into the harness each round.
 */
export interface AgentSource {
  id: string;
  provider: AgentProvider | "builtin";
  workspace?: string;
  model?: string;
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

/** Fail fast if any agent's LLM provider API key is missing from the environment. */
export function validateAgentEnvironment(agents: AgentSource[]): void {
  const missingCredentials: Array<{
    agentId: string;
    provider: AgentProvider;
    missing: string[];
  }> = [];

  for (const agent of agents) {
    if (agent.provider === "builtin") {
      continue; // Builtin agents don't need API keys
    }

    if (
      agent.provider === "google" ||
      agent.provider === "openai" ||
      agent.provider === "anthropic"
    ) {
      continue; // OAuth-based providers — no API key needed
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
      const providerDefaults = getProviderEnvDefaults(provider);
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
  /** Path to the Rust harness binary (required for local mode with workspace agents). */
  harnessPath?: string;
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
    harnessPath,
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

  // In local mode, compile workspace agents and start the harness once
  // before the round loop. Programs don't change between rounds in local
  // mode (no edit phase without Docker), so one harness serves all rounds.
  const invalidAgents: Record<string, string> = {};
  let harness: HarnessClient | null = null;

  if (!useContainerCompetition && harnessPath) {
    const workspaceAgents = agentSources.filter(
      (a): a is AgentSource & { workspace: string } =>
        a.provider !== "builtin" && typeof a.workspace === "string",
    );

    if (workspaceAgents.length > 0) {
      const onchain: OnchainWorkspaceAgent[] = [];
      for (const a of workspaceAgents) {
        const workspace = await validateWorkspaceForArena(
          config.arena_id,
          a.workspace,
        );
        onchain.push({ id: a.id, workspace });
      }

      const prepared = await prepareProgramsAndInvalidAgents(onchain);
      Object.assign(invalidAgents, prepared.invalidAgents);

      if (prepared.programs.length > 0) {
        harness = await HarnessClient.start(
          harnessPath,
          prepared.programs,
          config.compute_unit_limit,
        );
        agents.push(...buildPolicies(prepared.programs, harness));
      }
    }
  }

  const roundRoot = join(outputDir, "rounds");
  await mkdir(roundRoot, { recursive: true });

  const collected: TournamentResult["rounds"] = [];

  try {
    for (let round = 1; round <= rounds; round++) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`Round ${round}/${rounds}`);
      console.log("=".repeat(60));

      const roundDir = join(roundRoot, `${round}`);
      await mkdir(roundDir, { recursive: true });

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

      const snapshotPaths = await snapshotWorkspaces(
        roundDir,
        outputDir,
        agentSources,
      );

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
        meta = deriveRoundMeta(
          roundStart,
          Date.now(),
          result.round_metrics,
          invalidAgents,
        );

        await writeRoundMeta(roundDir, meta);
      }

      collected.push({ round_num: round, meta });

      if (meta.winner) {
        console.log(
          `\nRound ${round} Winner: ${meta.winner} (score: ${meta.scores[meta.winner]?.toFixed(2) ?? "N/A"})`,
        );
      }

      const snapshotsRoot = toPosixPath(
        relative(outputDir, join(roundDir, "workspaces")),
      );
      const agentList =
        agentSources.length > 0
          ? agentSources.map((agent) => ({
              agent_id: agent.id,
              origin: agent.provider === "builtin" ? "builtin" : "workspace",
              snapshot_path: snapshotPaths.get(agent.id) ?? null,
              score: meta.scores[agent.id] ?? null,
              invalid_reason: meta.invalid_agents[agent.id] ?? null,
            }))
          : agents.map((agent) => ({
              agent_id: agent.id,
              origin: "policy",
              snapshot_path: null,
              score: meta.scores[agent.id] ?? null,
              invalid_reason: meta.invalid_agents[agent.id] ?? null,
            }));

      const snapshotIndexPath = join(roundDir, "snapshot_index.json");
      await Bun.write(
        snapshotIndexPath,
        JSON.stringify(
          {
            round,
            snapshots_root: snapshotsRoot,
            agents: agentList,
          },
          null,
          2,
        ),
      );
      console.log(
        "FILE_WRITE",
        "write",
        snapshotIndexPath,
        `round=${round}`,
        `agents=${agentList.length}`,
      );

      if (injectTargets.length > 0) {
        await injectLogs(roundDir, round, injectTargets);
      }
    }
  } finally {
    if (harness) {
      await harness.shutdown();
    }
  }

  // Write tournament-level summary.
  const agentIds =
    agentSources.length > 0
      ? agentSources.map((agent) => agent.id)
      : agents.map((agent) => agent.id);

  const tournamentPath = join(outputDir, "tournament.json");
  await Bun.write(
    tournamentPath,
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
  console.log(
    "FILE_WRITE",
    "write",
    tournamentPath,
    `rounds=${collected.length}`,
    `agents=${agentIds.length}`,
  );

  return { rounds: collected };
}
