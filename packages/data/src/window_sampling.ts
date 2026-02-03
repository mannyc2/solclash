import type {
  OhlcvBar,
  WindowDef,
  WindowSamplingConfig,
} from "@solclash/simulator";

export interface WindowStats {
  window_id: string;
  volatility: number;
  trend: number;
  volume: number;
}

export function computeWindowStats(
  bars: OhlcvBar[],
  windowDef: WindowDef,
): WindowStats {
  const slice = bars.slice(windowDef.start_index, windowDef.end_index + 1);
  if (slice.length === 0) {
    return { window_id: windowDef.window_id, volatility: 0, trend: 0, volume: 0 };
  }

  const closes = slice.map((b) => b.close);
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1] ?? closes[0]!;
    const curr = closes[i] ?? prev;
    const denom = prev === 0 ? 1 : prev;
    returns.push((curr - prev) / denom);
  }

  const mean = returns.length
    ? returns.reduce((a, b) => a + b, 0) / returns.length
    : 0;
  let variance = 0;
  for (const r of returns) {
    const diff = r - mean;
    variance += diff * diff;
  }
  variance = returns.length ? variance / returns.length : 0;
  const volatility = Math.sqrt(variance);

  const first = closes[0] ?? 0;
  const last = closes[closes.length - 1] ?? first;
  const trend = first === 0 ? 0 : (last - first) / first;

  const volume =
    slice.reduce((sum, b) => sum + b.volume, 0) / slice.length;

  return { window_id: windowDef.window_id, volatility, trend, volume };
}

export function selectWindows(
  windows: WindowDef[],
  bars: OhlcvBar[],
  sampling: WindowSamplingConfig,
  total: number,
): WindowDef[] {
  if (total <= 0) return [];
  if (windows.length <= total) return [...windows];

  if (sampling.mode === "sequential") {
    return windows.slice(0, total);
  }

  // Stratified sampling uses hash ordering to stay deterministic without RNG.
  const stats = windows.map((w) => computeWindowStats(bars, w));
  const seed = sampling.seed ?? "";

  const stressCount = Math.min(
    sampling.stress_count ?? 0,
    total,
    windows.length,
  );

  const stressIds = new Set(
    // Stress windows are the most volatile; a hash breaks ties deterministically.
    [...stats]
      .sort(
        (a, b) =>
          b.volatility - a.volatility ||
          hashKey(a.window_id, seed) - hashKey(b.window_id, seed),
      )
      .slice(0, stressCount)
      .map((s) => s.window_id),
  );

  const stressWindows = windows.filter((w) => stressIds.has(w.window_id));
  const remaining = windows.filter((w) => !stressIds.has(w.window_id));

  const bucketConfig = sampling.buckets ?? {
    volatility: 3,
    trend: 3,
    volume: 3,
  };
  const volBuckets = assignBuckets(stats, "volatility", bucketConfig.volatility);
  const trendBuckets = assignBuckets(stats, "trend", bucketConfig.trend);
  const volumeBuckets = assignBuckets(stats, "volume", bucketConfig.volume);

  const groups = new Map<string, WindowDef[]>();
  for (const w of remaining) {
    const vb = volBuckets.get(w.window_id) ?? 0;
    const tb = trendBuckets.get(w.window_id) ?? 0;
    const volb = volumeBuckets.get(w.window_id) ?? 0;
    const key = `${vb}-${tb}-${volb}`;
    const list = groups.get(key) ?? [];
    list.push(w);
    groups.set(key, list);
  }

  for (const list of groups.values()) {
    // Keep selection order stable within buckets across runs.
    list.sort(
      (a, b) =>
        hashKey(a.window_id, seed) - hashKey(b.window_id, seed),
    );
  }

  const groupKeys = Array.from(groups.keys()).sort(
    (a, b) => hashKey(a, seed) - hashKey(b, seed),
  );

  const selected: WindowDef[] = [...stressWindows];
  let added = true;
  while (selected.length < total && added) {
    added = false;
    for (const key of groupKeys) {
      const list = groups.get(key);
      if (!list || list.length === 0) continue;
      selected.push(list.shift()!);
      added = true;
      if (selected.length >= total) break;
    }
  }

  if (selected.length < total) {
    for (const w of remaining) {
      if (selected.length >= total) break;
      if (!selected.includes(w)) {
        selected.push(w);
      }
    }
  }

  return selected.slice(0, total);
}

function assignBuckets(
  stats: WindowStats[],
  key: keyof WindowStats,
  bucketCount: number,
): Map<string, number> {
  const buckets = Math.max(1, bucketCount);
  const sorted = [...stats].sort((a, b) => a[key] - b[key]);
  const map = new Map<string, number>();
  const total = sorted.length;
  if (total === 0) return map;

  for (let i = 0; i < total; i++) {
    const bucket = Math.min(
      buckets - 1,
      Math.floor((i / total) * buckets),
    );
    map.set(sorted[i]!.window_id, bucket);
  }
  return map;
}

function hashKey(value: string, seed: string): number {
  return fnv1a(`${seed}:${value}`);
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
    hash >>>= 0;
  }
  return hash;
}
