#!/usr/bin/env bun
/**
 * Tournament CLI entry point.
 *
 * Runs a multi-round tournament: load config → resolve agents → copy
 * workspaces → run the edit→compete→score loop via runTournament().
 *
 * Players are defined in the config file's `players` array.
 *
 * Flags:
 *   --local      Skip Docker — compile and run agents directly on the host.
 *                Also used by competition/container.ts when re-invoking
 *                this CLI inside a container that's already isolated.
 *   --no-edit    Disable the Claude Code edit phase (skip LLM calls).
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  getArenaDefinition,
  loadArenaContext,
  resolveBaselines,
} from "@solclash/arenas";
import { parseArgs } from "node:util";
import { buildEditConfig } from "./edit/config.js";
import { DockerRuntime } from "./runtime/docker.js";
import { runTournament } from "./runner.js";
import type { AgentSource } from "./runner.js";

const DEFAULT_HARNESS_PATH =
  "./apps/arena-harness/target/release/solclash-harness";

function getUsageText(): string {
  return "Usage: solclash-tournament --config <path> [--data <path>] [--rounds <n>] [--output <dir>] [--harness <path>] [--no-edit] [--local]";
}

function parseRounds(roundsRaw: string | undefined, fallback: number): number {
  const raw = roundsRaw ?? String(fallback);
  const rounds = Math.max(1, Number(raw));
  if (!Number.isFinite(rounds)) {
    throw new Error(`Invalid --rounds value: ${raw}`);
  }
  return rounds;
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: Bun.argv,
    options: {
      config: { type: "string", short: "c" },
      data: { type: "string", short: "d" },
      output: { type: "string", short: "o", default: "./logs" },
      rounds: { type: "string", short: "r" },
      harness: { type: "string" },
      local: { type: "boolean", default: false },
      "no-edit": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: true,
  });
  const values = parsed.values as {
    config?: string;
    data?: string;
    output: string;
    rounds?: string;
    harness?: string;
    local: boolean;
    "no-edit": boolean;
  };

  if (!values.config) {
    throw new Error(getUsageText());
  }

  const {
    config: finalConfig,
    bars,
    tournament,
    players,
  } = await loadArenaContext({
    configPath: values.config,
    dataPath: values.data,
  });
  console.log(`Loaded ${bars.length} bars`);

  const rounds = parseRounds(values.rounds, tournament?.rounds ?? 1);
  const { agents } = resolveBaselines(
    finalConfig.arena_id,
    finalConfig.baseline_bots_enabled,
  );

  const outputRoot = resolve(values.output);
  const workspacesRoot = join(outputRoot, "workspaces");
  await mkdir(workspacesRoot, { recursive: true });

  const agentSources: AgentSource[] = [];
  for (const name of finalConfig.baseline_bots_enabled) {
    agentSources.push({ id: name, provider: "builtin" });
  }

  // Copy arena starter to each player's working directory
  const definition = getArenaDefinition(finalConfig.arena_id);
  const starterPath = resolve(definition.starter_path);

  const injectTargets: string[] = [];
  for (const player of players) {
    const workingCopy = join(workspacesRoot, player.name);
    await rm(workingCopy, { recursive: true, force: true });
    await cp(starterPath, workingCopy, { recursive: true });
    agentSources.push({
      id: player.name,
      provider: player.provider,
      workspace: workingCopy,
      model: player.model,
    });
    injectTargets.push(workingCopy);
  }

  console.log(`Agents: ${agentSources.map((agent) => agent.id).join(", ")}`);

  const editFromConfig = tournament?.edit;
  const editConfig = buildEditConfig({
    ...editFromConfig,
    enabled: values["no-edit"] ? false : (editFromConfig?.enabled ?? true),
    prompt_ref: editFromConfig?.prompt_ref ?? "default",
  });

  const useLocal = values.local;
  const runtime = useLocal ? undefined : new DockerRuntime();

  const result = await runTournament({
    config: finalConfig,
    bars,
    agents,
    agentSources,
    rounds,
    outputDir: outputRoot,
    injectTargets: [...new Set(injectTargets)],
    edit: editConfig,
    runtime,
    harnessPath: values.harness ?? DEFAULT_HARNESS_PATH,
  });

  console.log(
    `\nTournament complete: ${result.rounds.length} rounds, logs at ${outputRoot}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
