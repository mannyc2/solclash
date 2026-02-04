import { existsSync } from "node:fs";
import { join } from "node:path";
import type { OhlcvBar, TapeSource } from "@solclash/simulator";
import {
  loadTapeFromJson,
  loadTapeFromJsonl,
  type TapeWithMeta,
} from "./loader.js";

export interface LoadTapeOptions {
  baseDir?: string;
  overridePath?: string;
  barIntervalSeconds?: number;
  symbol?: string;
}

export async function loadTape(
  tapeSource: TapeSource,
  opts: LoadTapeOptions = {},
): Promise<OhlcvBar[]> {
  const tape = await loadTapeWithMeta(tapeSource, opts);
  return tape.bars;
}

export async function loadTapeWithMeta(
  tapeSource: TapeSource,
  opts: LoadTapeOptions = {},
): Promise<TapeWithMeta> {
  if (opts.overridePath) {
    return loadFromPathWithMeta(opts.overridePath);
  }

  if (tapeSource.type === "historical") {
    if (tapeSource.path) {
      return loadFromPathWithMeta(tapeSource.path);
    }
    if (tapeSource.dataset_id) {
      const baseDir = opts.baseDir ?? process.cwd();
      const dataDir = join(baseDir, "data");
      // Resolve dataset_id relative to ./data and prefer JSONL when available.
      const jsonlPath = join(dataDir, `${tapeSource.dataset_id}.jsonl`);
      if (existsSync(jsonlPath)) {
        return loadTapeFromJsonl(jsonlPath);
      }
      const jsonPath = join(dataDir, `${tapeSource.dataset_id}.json`);
      if (existsSync(jsonPath)) {
        return loadTapeFromJson(jsonPath);
      }
      throw new Error(
        `Dataset not found: ${tapeSource.dataset_id} (tried ${jsonlPath} and ${jsonPath})`,
      );
    }
    throw new Error("Historical tape_source requires dataset_id or path");
  }

  return { bars: generateSyntheticTape(tapeSource, opts) };
}

async function loadFromPathWithMeta(filePath: string): Promise<TapeWithMeta> {
  return filePath.endsWith(".jsonl")
    ? loadTapeFromJsonl(filePath)
    : loadTapeFromJson(filePath);
}

function generateSyntheticTape(
  tapeSource: Extract<TapeSource, { type: "synthetic" }>,
  opts: LoadTapeOptions,
): OhlcvBar[] {
  if (tapeSource.generator_id !== "gbm_v1") {
    throw new Error(`Unsupported generator_id: ${tapeSource.generator_id}`);
  }

  const params = tapeSource.params;
  const totalBars = toNumber(params.total_bars);
  if (!Number.isFinite(totalBars) || totalBars <= 0) {
    throw new Error("synthetic tape requires params.total_bars > 0");
  }

  const barIntervalSeconds = opts.barIntervalSeconds ?? 60;
  const symbol = opts.symbol ?? "BTC-PERP";

  const startPrice = numberOr(params.start_price, 50_000);
  const driftBpsPerBar = numberOr(params.drift_bps_per_bar, 0);
  const volBpsPerSqrtBar = numberOr(params.vol_bps_per_sqrt_bar, 50);
  const volumeMean = numberOr(params.volume_mean, 100);
  const volumeStd = numberOr(params.volume_std, 20);

  const drift = driftBpsPerBar / 10_000;
  const vol = volBpsPerSqrtBar / 10_000;

  // Seeded RNG keeps synthetic tapes deterministic across runs.
  const rand = mulberry32(tapeSource.seed);
  const randn = () => boxMuller(rand);

  const bars: OhlcvBar[] = [];
  let price = startPrice;

  for (let i = 0; i < totalBars; i++) {
    const open = price;
    const shock = randn();
    const close = Math.max(1, open * (1 + drift + vol * shock));
    const high = Math.max(open, close) * (1 + Math.abs(randn()) * 0.001);
    const low = Math.max(
      1,
      Math.min(open, close) * (1 - Math.abs(randn()) * 0.001),
    );
    const volume = Math.max(0, volumeMean + volumeStd * randn());

    const barStart = i * barIntervalSeconds * 1000;
    bars.push({
      symbol,
      bar_start_ts_ms: barStart,
      bar_end_ts_ms: barStart + barIntervalSeconds * 1000,
      open,
      high,
      low,
      close,
      volume,
    });

    price = close;
  }

  return bars;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function boxMuller(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function numberOr(value: unknown, fallback: number): number {
  const n = toNumber(value);
  return Number.isFinite(n) ? n : fallback;
}
