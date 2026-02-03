#!/usr/bin/env bun
import {
  ArenaConfigSchema,
  ScoringWeightsSchema,
  type TapeSource,
  type OhlcvBar,
  type PolicyFn,
  type ArenaConfigResolved,
} from "@solclash/simulator";
import { loadTapeWithMeta } from "@solclash/data";
import { resolveAgentsWithErrors } from "./agents.js";
import { executeRound } from "./runner.js";
import { writeRoundMeta } from "./logger.js";
import { parseArgs } from "util";
import { HarnessClient, type HarnessProgram } from "./harness.js";
import { basename, join, resolve } from "node:path";
import { $ } from "bun";
import { resolveScoringWeightsPath } from "./weights.js";

async function main() {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      config: { type: "string", short: "c" },
      data: { type: "string", short: "d" },
      output: { type: "string", short: "o", default: "./output" },
      agents: { type: "string", short: "a", multiple: true, default: [] },
      "onchain-agents": { type: "string", multiple: true, default: [] },
      harness: { type: "string" },
    },
    strict: true,
    allowPositionals: true,
  });

  if (!values.config) {
    console.error(
      "Usage: solclash-arena --config <path> [--data <path>] [--output <dir>] [--agents <path>...] [--onchain-agents <path>...] [--harness <path>]",
    );
    process.exit(1);
  }

  // Validate config early to fail fast before loading data or agents.
  const configRaw = await Bun.file(values.config).json();
  const configResult = ArenaConfigSchema.safeParse(configRaw);
  if (!configResult.success) {
    console.error("Invalid config:", configResult.error.format());
    process.exit(1);
  }
  const config = configResult.data;
  let scoringWeights = config.scoring_weights;
  if (!scoringWeights) {
    // Resolve scoring weights now so runtime always sees concrete weights.
    // This supports shared presets or explicit paths without duplicating JSON.
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
  const rawConfig = configRaw as Record<string, unknown>;
  // Use tape metadata as defaults while letting explicit config values win.
  const explicit = {
    symbol: "symbol" in rawConfig,
    base_mint: "base_mint" in rawConfig,
    quote_mint: "quote_mint" in rawConfig,
    price_scale: "price_scale" in rawConfig,
    volume_scale: "volume_scale" in rawConfig,
  };

  // Load bars first; metadata may inform the resolved instrument fields.
  let bars: OhlcvBar[];
  let instrumentMeta:
    | { symbol?: string; base_mint?: string; quote_mint?: string; price_scale?: number; volume_scale?: number }
    | undefined;
  if (values.data) {
    // --data overrides tape_source but still allows metadata ingestion from the file.
    const fallbackSource: TapeSource = { type: "historical", path: values.data };
    const tape = await loadTapeWithMeta(resolvedConfig.tape_source ?? fallbackSource, {
      overridePath: values.data,
      baseDir: process.cwd(),
      barIntervalSeconds: resolvedConfig.bar_interval_seconds,
      symbol: resolvedConfig.symbol,
    });
    bars = tape.bars;
    instrumentMeta = tape.instrument;
  } else {
    if (!resolvedConfig.tape_source) {
      console.error("tape_source is required in config when --data is not provided");
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
    // Merge metadata only for fields the user did not set explicitly.
    finalConfig = {
      ...finalConfig,
      symbol: explicit.symbol ? finalConfig.symbol : (instrumentMeta.symbol ?? finalConfig.symbol),
      base_mint: explicit.base_mint ? finalConfig.base_mint : (instrumentMeta.base_mint ?? finalConfig.base_mint),
      quote_mint: explicit.quote_mint ? finalConfig.quote_mint : (instrumentMeta.quote_mint ?? finalConfig.quote_mint),
      price_scale: explicit.price_scale ? finalConfig.price_scale : (instrumentMeta.price_scale ?? finalConfig.price_scale),
      volume_scale: explicit.volume_scale ? finalConfig.volume_scale : (instrumentMeta.volume_scale ?? finalConfig.volume_scale),
    };
  }

  console.log(`Loaded ${bars.length} bars`);

  // Resolve agents before starting the harness so invalid JS modules are tracked.
  const {
    agents,
    invalidAgents: invalidJsAgents,
  } = await resolveAgentsWithErrors(
    finalConfig.baseline_bots_enabled,
    values.agents ?? [],
  );

  const onchainAgentDirs = (values["onchain-agents"] ?? []) as string[];
  let harness: HarnessClient | null = null;
  const invalidAgents: Record<string, string> = { ...invalidJsAgents };

  if (onchainAgentDirs.length > 0) {
    const harnessPath =
      values.harness ??
      "./apps/arena-harness/target/release/solclash-harness";
    const programs: HarnessProgram[] = [];

    for (const dir of onchainAgentDirs) {
      const root = resolve(dir);
      const programDir = join(root, "program");
      const agentId = basename(root);
      try {
        // Build on-chain agents locally; failures should not abort the round.
        await $`cargo build-sbf`.cwd(programDir);
      } catch (_err) {
        invalidAgents[agentId] = "build_failed";
        continue;
      }

      const soPath = join(
        programDir,
        "target",
        "deploy",
        "solclash_policy.so",
      );
      if (!(await Bun.file(soPath).exists())) {
        invalidAgents[agentId] = "missing_artifact";
        continue;
      }
      programs.push({ id: agentId, so_path: soPath });
    }

    if (programs.length > 0) {
      // Start a single harness process for all on-chain agents this round.
      harness = await HarnessClient.start(
        harnessPath,
        programs,
        finalConfig.compute_unit_limit,
      );
    }

    for (const program of programs) {
      const policy: PolicyFn = async (input) => {
        if (!harness) {
          throw new Error("Harness not initialized");
        }
        return harness.eval(program.id, input);
      };
      agents.push({ id: program.id, policy });
    }
  }

  console.log(`Agents: ${agents.map((a) => a.id).join(", ")}`);

  const roundStart = Date.now();
  try {
    // Run the round once all agents are ready.
    const result = await executeRound(finalConfig, bars, agents, values.output!);
    const roundEnd = Date.now();

    // Include invalid agents with zero scores in round_meta for traceability.
    const scores: Record<string, number> = {};
    for (const [agentId, metrics] of Object.entries(result.round_metrics)) {
      scores[agentId] = metrics.score;
    }
    for (const [agentId] of Object.entries(invalidAgents)) {
      if (!(agentId in scores)) {
        scores[agentId] = 0;
      }
    }

    let winner: string | null = null;
    let bestScore = -Infinity;
    for (const [agentId, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        winner = agentId;
      }
    }

    await writeRoundMeta(values.output!, {
      round_start_ts: roundStart,
      round_end_ts: roundEnd,
      winner,
      scores,
      invalid_agents: invalidAgents,
    });

    // Print results for human-readable inspection; artifacts are written separately.
    console.log("\n--- Round Results ---");
    for (const [agentId, metrics] of Object.entries(result.round_metrics)) {
      console.log(
        `${agentId}: score=${metrics.score.toFixed(2)} pnl=${metrics.pnl_total.toFixed(2)} dd=${metrics.drawdown_max.toFixed(2)} exp=${metrics.exposure_avg.toFixed(2)}`,
      );
    }
    console.log(`\nLogs written to ${values.output}`);
  } finally {
    if (harness) {
      await harness.shutdown();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
