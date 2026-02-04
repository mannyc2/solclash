#!/usr/bin/env bun
import { parseArgs } from "util";
import { join, resolve } from "node:path";
import { cp, mkdir, rm } from "node:fs/promises";
import {
  ArenaConfigSchema,
  ScoringWeightsSchema,
  type ArenaConfigResolved,
} from "@solclash/simulator";
import { loadTapeWithMeta } from "@solclash/data";
import {
  loadAgentManifests,
  validateAgentManifestsForArena,
} from "@solclash/agents";
import {
  getArenaDefinition,
  validateSupportedBaselines,
  validateWorkspaceForArena,
} from "@solclash/arenas";
import { resolveAgentsWithErrors } from "@solclash/arena";
import { resolveScoringWeightsPath } from "../../arena/src/weights.js";
import { runTournament } from "./runner.js";
import { buildEditConfig } from "./edit/config.js";
import type { AgentSource } from "./runner.js";
import { DockerRuntime } from "./runtime/docker.js";

async function main() {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      config: { type: "string", short: "c" },
      data: { type: "string", short: "d" },
      output: { type: "string", short: "o", default: "./logs" },
      rounds: { type: "string", short: "r", default: "1" },
      agent: { type: "string", short: "a", multiple: true, default: [] },
      "no-edit": { type: "boolean", default: false },
      "edit-prompt": { type: "string", default: "default" },
      "edit-max-turns": { type: "string", default: "250" },
      "edit-concurrency": { type: "string", default: "4" },
      "edit-timeout-ms": { type: "string" },
      "edit-network-enabled": { type: "boolean", default: false },
      "edit-network-allowlist": { type: "string", multiple: true, default: [] },
      "edit-model": { type: "string" },
    },
    strict: true,
    allowPositionals: true,
  });

  if (!values.config) {
    console.error(
      "Usage: solclash-tournament --config <path> [--data <path>] [--rounds <n>] [--output <dir>] [--agent <manifest_path>...] [--no-edit] [--edit-prompt <id|path>] [--edit-max-turns <n>] [--edit-concurrency <n>] [--edit-timeout-ms <n>] [--edit-network-enabled] [--edit-network-allowlist <host>...]",
    );
    process.exit(1);
  }

  const rounds = Math.max(1, Number(values.rounds));
  if (!Number.isFinite(rounds)) {
    throw new Error(`Invalid --rounds value: ${values.rounds}`);
  }

  const editMaxTurns = Number(values["edit-max-turns"]);
  if (!Number.isFinite(editMaxTurns) || editMaxTurns <= 0) {
    throw new Error(
      `Invalid --edit-max-turns value: ${values["edit-max-turns"]}`,
    );
  }

  const editConcurrency = Number(values["edit-concurrency"]);
  if (!Number.isFinite(editConcurrency) || editConcurrency <= 0) {
    throw new Error(
      `Invalid --edit-concurrency value: ${values["edit-concurrency"]}`,
    );
  }

  const editTimeoutMs = values["edit-timeout-ms"]
    ? Number(values["edit-timeout-ms"])
    : undefined;
  if (editTimeoutMs !== undefined && !Number.isFinite(editTimeoutMs)) {
    throw new Error(
      `Invalid --edit-timeout-ms value: ${values["edit-timeout-ms"]}`,
    );
  }

  // Validate config
  const configRaw = await Bun.file(values.config).json();
  const configResult = ArenaConfigSchema.safeParse(configRaw);
  if (!configResult.success) {
    console.error("Invalid config:", configResult.error.format());
    process.exit(1);
  }
  const config = configResult.data;

  // Ensure this arena exists and baseline selections are valid.
  getArenaDefinition(config.arena_id);
  validateSupportedBaselines(config.arena_id, config.baseline_bots_enabled);

  let scoringWeights = config.scoring_weights;
  if (!scoringWeights) {
    const refValue = config.scoring_weights_reference;
    const refPath = resolveScoringWeightsPath(refValue, process.cwd());
    const rawWeights = await Bun.file(refPath).json();
    const weightsResult = ScoringWeightsSchema.safeParse(rawWeights);
    if (!weightsResult.success) {
      console.error(
        `Invalid scoring weights at ${refPath}:`,
        weightsResult.error.format(),
      );
      process.exit(1);
    }
    scoringWeights = weightsResult.data;
  }

  const resolvedConfig: ArenaConfigResolved = {
    ...config,
    scoring_weights: scoringWeights,
  };

  // Load bars
  const rawConfig = configRaw as Record<string, unknown>;
  const explicit = {
    symbol: "symbol" in rawConfig,
    base_mint: "base_mint" in rawConfig,
    quote_mint: "quote_mint" in rawConfig,
    price_scale: "price_scale" in rawConfig,
    volume_scale: "volume_scale" in rawConfig,
  };

  let bars;
  let instrumentMeta:
    | {
        symbol?: string;
        base_mint?: string;
        quote_mint?: string;
        price_scale?: number;
        volume_scale?: number;
      }
    | undefined;

  if (values.data) {
    const fallbackSource = { type: "historical" as const, path: values.data };
    const tape = await loadTapeWithMeta(
      resolvedConfig.tape_source ?? fallbackSource,
      {
        overridePath: values.data,
        baseDir: process.cwd(),
        barIntervalSeconds: resolvedConfig.bar_interval_seconds,
        symbol: resolvedConfig.symbol,
      },
    );
    bars = tape.bars;
    instrumentMeta = tape.instrument;
  } else {
    if (!resolvedConfig.tape_source) {
      console.error(
        "tape_source is required in config when --data is not provided",
      );
      process.exit(1);
    }
    const tape = await loadTapeWithMeta(resolvedConfig.tape_source, {
      baseDir: process.cwd(),
      barIntervalSeconds: resolvedConfig.bar_interval_seconds,
      symbol: resolvedConfig.symbol,
    });
    bars = tape.bars;
    instrumentMeta = tape.instrument;
  }

  let finalConfig = resolvedConfig;
  if (instrumentMeta) {
    finalConfig = {
      ...finalConfig,
      symbol: explicit.symbol
        ? finalConfig.symbol
        : (instrumentMeta.symbol ?? finalConfig.symbol),
      base_mint: explicit.base_mint
        ? finalConfig.base_mint
        : (instrumentMeta.base_mint ?? finalConfig.base_mint),
      quote_mint: explicit.quote_mint
        ? finalConfig.quote_mint
        : (instrumentMeta.quote_mint ?? finalConfig.quote_mint),
      price_scale: explicit.price_scale
        ? finalConfig.price_scale
        : (instrumentMeta.price_scale ?? finalConfig.price_scale),
      volume_scale: explicit.volume_scale
        ? finalConfig.volume_scale
        : (instrumentMeta.volume_scale ?? finalConfig.volume_scale),
    };
  }

  console.log(`Loaded ${bars.length} bars`);

  const agentManifestPaths = values.agent as string[];
  const agentManifests = await loadAgentManifests(agentManifestPaths);
  validateAgentManifestsForArena(agentManifests, finalConfig.arena_id);

  const baselineIds = new Set(finalConfig.baseline_bots_enabled);
  for (const manifest of agentManifests) {
    if (baselineIds.has(manifest.id)) {
      throw new Error(
        `Agent id collides with builtin baseline: ${manifest.id}`,
      );
    }
  }

  const validatedWorkspaces = new Map<string, string>();
  for (const manifest of agentManifests) {
    try {
      const workspace = await validateWorkspaceForArena(
        finalConfig.arena_id,
        manifest.workspace_path,
      );
      validatedWorkspaces.set(manifest.id, workspace.root_dir);
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid workspace";
      throw new Error(
        `Invalid workspace for agent '${manifest.id}' at ${manifest.workspace_path}: ${message}`,
      );
    }
  }

  const { agents } = await resolveAgentsWithErrors(
    finalConfig.baseline_bots_enabled,
    [],
  );

  const outputRoot = resolve(values.output);

  // Copy agent workspaces into <outputRoot>/workspaces/ so the source
  // directories stay immutable across tournament runs.
  const workspacesRoot = join(outputRoot, "workspaces");
  await mkdir(workspacesRoot, { recursive: true });

  const agentSources: AgentSource[] = [];
  for (const name of finalConfig.baseline_bots_enabled) {
    agentSources.push({ id: name, provider: "builtin" });
  }

  const injectTargets: string[] = [];

  for (const manifest of agentManifests) {
    const workspaceRoot = validatedWorkspaces.get(manifest.id);
    if (!workspaceRoot) {
      throw new Error(`Missing validated workspace for agent '${manifest.id}'`);
    }
    const workingCopy = join(workspacesRoot, manifest.id);
    await rm(workingCopy, { recursive: true, force: true });
    await cp(workspaceRoot, workingCopy, { recursive: true });
    agentSources.push({
      id: manifest.id,
      provider: manifest.provider,
      workspace: workingCopy,
      model: manifest.model,
    });
    injectTargets.push(workingCopy);
  }

  console.log(`Agents: ${agentSources.map((agent) => agent.id).join(", ")}`);

  const editEnabled = !values["no-edit"];
  const editConfig = buildEditConfig({
    enabled: editEnabled,
    prompt_ref: values["edit-prompt"],
    max_turns: editMaxTurns,
    concurrency: editConcurrency,
    timeout_ms: editTimeoutMs,
    network_policy: {
      enabled: values["edit-network-enabled"],
      allowlist: values["edit-network-allowlist"] as string[],
    },
    model: values["edit-model"],
  });

  const runtime = new DockerRuntime();

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
  });

  console.log(
    `\nTournament complete: ${result.rounds.length} rounds, logs at ${outputRoot}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
