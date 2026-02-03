#!/usr/bin/env bun
import { parseArgs } from "util";
import { dirname, resolve } from "node:path";
import { statSync } from "node:fs";
import {
  ArenaConfigSchema,
  ScoringWeightsSchema,
  type ArenaConfigResolved,
} from "@solclash/simulator";
import { loadTapeWithMeta } from "@solclash/data";
import { resolveAgentsWithErrors } from "@solclash/arena";
import { resolveScoringWeightsPath } from "../../arena/src/weights.js";
import { runTournament } from "./runner.js";

async function main() {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      config: { type: "string", short: "c" },
      data: { type: "string", short: "d" },
      output: { type: "string", short: "o", default: "./logs" },
      rounds: { type: "string", short: "r", default: "1" },
      agents: { type: "string", short: "a", multiple: true, default: [] },
      "onchain-agents": { type: "string", multiple: true, default: [] },
      harness: { type: "string" },
    },
    strict: true,
    allowPositionals: true,
  });

  if (!values.config) {
    console.error(
      "Usage: solclash-tournament --config <path> [--data <path>] [--rounds <n>] [--output <dir>] [--agents <path>...] [--onchain-agents <path>...] [--harness <path>]",
    );
    process.exit(1);
  }

  const rounds = Math.max(1, Number(values.rounds));
  if (!Number.isFinite(rounds)) {
    throw new Error(`Invalid --rounds value: ${values.rounds}`);
  }

  // Validate config
  const configRaw = await Bun.file(values.config).json();
  const configResult = ArenaConfigSchema.safeParse(configRaw);
  if (!configResult.success) {
    console.error("Invalid config:", configResult.error.format());
    process.exit(1);
  }
  const config = configResult.data;

  let scoringWeights = config.scoring_weights;
  if (!scoringWeights) {
    const refValue =
      config.scoring_weights_reference ?? "docs/scoring-weights.json";
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

  // Resolve agents
  const agentPaths = (values.agents ?? []) as string[];
  const { agents } = await resolveAgentsWithErrors(
    finalConfig.baseline_bots_enabled,
    agentPaths,
  );

  console.log(`Agents: ${agents.map((a) => a.id).join(", ")}`);

  // Build inject targets from agent paths + onchain-agent dirs
  const onchainAgentDirs = (values["onchain-agents"] ?? []) as string[];
  const injectTargets: string[] = [];
  for (const p of agentPaths) {
    const abs = resolve(p);
    const stat = statSync(abs);
    injectTargets.push(stat.isDirectory() ? abs : dirname(abs));
  }
  for (const dir of onchainAgentDirs) {
    injectTargets.push(resolve(dir));
  }

  const outputRoot = resolve(values.output ?? "./logs");

  const result = await runTournament({
    config: finalConfig,
    bars,
    agents,
    rounds,
    outputDir: outputRoot,
    injectTargets: [...new Set(injectTargets)],
  });

  console.log(
    `\nTournament complete: ${result.rounds.length} rounds, logs at ${outputRoot}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
