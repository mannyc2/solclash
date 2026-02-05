import {
  ArenaConfigSchema,
  ScoringWeightsSchema,
  type ArenaConfigResolved,
  type OhlcvBar,
  type TapeSource,
} from "@solclash/simulator";
import { loadTapeWithMeta } from "@solclash/data";
import { resolve } from "node:path";
import { z } from "zod";
import { getArenaDefinition, validateSupportedBaselines } from "./index.js";

export const AGENT_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "glm",
  "kimi",
] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

const NetworkPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    allowlist: z.array(z.string()).default([]),
  })
  .default({ enabled: false, allowlist: [] });

export const TournamentEditConfigSchema = z.object({
  enabled: z.boolean().default(true),
  prompt_ref: z.string().default("default"),
  max_turns: z.number().int().positive().default(250),
  concurrency: z.number().int().positive().default(4),
  timeout_ms: z.number().int().positive().optional(),
  network_policy: NetworkPolicySchema,
  model: z.string().optional(),
});

export const TournamentConfigSchema = z.object({
  rounds: z.number().int().positive().default(1),
  edit: TournamentEditConfigSchema.optional(),
});

export type TournamentConfig = z.infer<typeof TournamentConfigSchema>;

export const PlayerSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(AGENT_PROVIDERS),
  model: z.string().min(1),
});

export type Player = z.infer<typeof PlayerSchema>;

export interface ArenaContext {
  config: ArenaConfigResolved;
  bars: OhlcvBar[];
  tournament?: TournamentConfig;
  players: Player[];
}

export function resolveScoringWeightsPath(
  refValue: string,
  cwd: string,
): string {
  return refValue.includes("/") || refValue.endsWith(".json")
    ? resolve(cwd, refValue)
    : resolve(cwd, "docs", "scoring-weights", `${refValue}.json`);
}

export async function loadArenaContext(opts: {
  configPath: string;
  dataPath?: string;
}): Promise<ArenaContext> {
  const configRaw = await Bun.file(opts.configPath).json();
  const configResult = ArenaConfigSchema.safeParse(configRaw);
  if (!configResult.success) {
    throw new Error(
      `Invalid config: ${configResult.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
    );
  }
  const config = configResult.data;

  getArenaDefinition(config.arena_id);
  validateSupportedBaselines(config.arena_id, config.baseline_bots_enabled);

  let scoringWeights = config.scoring_weights;
  if (!scoringWeights) {
    const refPath = resolveScoringWeightsPath(
      config.scoring_weights_reference,
      process.cwd(),
    );
    const rawWeights = await Bun.file(refPath).json();
    const weightsResult = ScoringWeightsSchema.safeParse(rawWeights);
    if (!weightsResult.success) {
      throw new Error(
        `Invalid scoring weights at ${refPath}: ${weightsResult.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
      );
    }
    scoringWeights = weightsResult.data;
  }

  const resolvedConfig: ArenaConfigResolved = {
    ...config,
    scoring_weights: scoringWeights,
  };

  // Load bars
  let bars: OhlcvBar[];
  let instrumentMeta:
    | {
        symbol?: string;
        base_mint?: string;
        quote_mint?: string;
        price_scale?: number;
        volume_scale?: number;
      }
    | undefined;

  if (opts.dataPath) {
    const fallbackSource: TapeSource = {
      type: "historical",
      path: opts.dataPath,
    };
    const tape = await loadTapeWithMeta(
      resolvedConfig.tape_source ?? fallbackSource,
      {
        overridePath: opts.dataPath,
        baseDir: process.cwd(),
        barIntervalSeconds: resolvedConfig.bar_interval_seconds,
        symbol: resolvedConfig.symbol,
      },
    );
    bars = tape.bars;
    instrumentMeta = tape.instrument;
  } else {
    if (!resolvedConfig.tape_source) {
      throw new Error(
        "tape_source is required in config when --data is not provided",
      );
    }
    const tape = await loadTapeWithMeta(resolvedConfig.tape_source, {
      baseDir: process.cwd(),
      barIntervalSeconds: resolvedConfig.bar_interval_seconds,
      symbol: resolvedConfig.symbol,
    });
    bars = tape.bars;
    instrumentMeta = tape.instrument;
  }

  // Merge instrument metadata from tape, respecting explicit config values
  let finalConfig = resolvedConfig;
  if (instrumentMeta) {
    const raw = configRaw as Record<string, unknown>;
    finalConfig = {
      ...resolvedConfig,
      symbol:
        "symbol" in raw
          ? resolvedConfig.symbol
          : (instrumentMeta.symbol ?? resolvedConfig.symbol),
      base_mint:
        "base_mint" in raw
          ? resolvedConfig.base_mint
          : (instrumentMeta.base_mint ?? resolvedConfig.base_mint),
      quote_mint:
        "quote_mint" in raw
          ? resolvedConfig.quote_mint
          : (instrumentMeta.quote_mint ?? resolvedConfig.quote_mint),
      price_scale:
        "price_scale" in raw
          ? resolvedConfig.price_scale
          : (instrumentMeta.price_scale ?? resolvedConfig.price_scale),
      volume_scale:
        "volume_scale" in raw
          ? resolvedConfig.volume_scale
          : (instrumentMeta.volume_scale ?? resolvedConfig.volume_scale),
    };
  }

  // Parse optional tournament section from raw config
  let tournament: TournamentConfig | undefined;
  const raw = configRaw as Record<string, unknown>;
  if ("tournament" in raw && raw.tournament != null) {
    const tournamentResult = TournamentConfigSchema.safeParse(raw.tournament);
    if (!tournamentResult.success) {
      throw new Error(
        `Invalid tournament config: ${tournamentResult.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
      );
    }
    tournament = tournamentResult.data;
  }

  // Parse optional players array from raw config
  let players: Player[] = [];
  if ("players" in raw && Array.isArray(raw.players)) {
    const playersResult = z.array(PlayerSchema).safeParse(raw.players);
    if (!playersResult.success) {
      throw new Error(
        `Invalid players: ${playersResult.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
      );
    }
    players = playersResult.data;

    // Check for duplicate player names
    const names = new Set<string>();
    for (const player of players) {
      if (names.has(player.name)) {
        throw new Error(`Duplicate player name: ${player.name}`);
      }
      names.add(player.name);
    }

    // Check for collision with baseline names
    const baselineNames = new Set(finalConfig.baseline_bots_enabled);
    for (const player of players) {
      if (baselineNames.has(player.name)) {
        throw new Error(
          `Player name collides with builtin baseline: ${player.name}`,
        );
      }
    }
  }

  return { config: finalConfig, bars, tournament, players };
}
