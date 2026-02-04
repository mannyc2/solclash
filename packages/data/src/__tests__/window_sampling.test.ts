import { expect, test } from "bun:test";
import { buildWindows } from "../windowing.js";
import { selectWindows } from "../window_sampling.js";
import type { OhlcvBar, WindowSamplingConfig } from "@solclash/simulator";

function makeBars(prices: number[]): OhlcvBar[] {
  return prices.map((p, i) => ({
    symbol: "BTC-PERP",
    bar_start_ts_ms: i * 60000,
    bar_end_ts_ms: (i + 1) * 60000,
    open: p,
    high: p * 1.01,
    low: p * 0.99,
    close: p,
    volume: 100 + i,
  }));
}

test("selectWindows sequential picks first N", () => {
  const bars = makeBars([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const windows = buildWindows(bars, 5, 0);
  const sampling: WindowSamplingConfig = {
    mode: "sequential",
    stress_count: 1,
    buckets: { volatility: 3, trend: 3, volume: 3 },
  };
  const selected = selectWindows(windows, bars, sampling, 2);
  expect(selected.map((w) => w.window_id)).toEqual(["w0", "w1"]);
});

test("selectWindows stratified includes stress window", () => {
  const bars = makeBars([
    100,
    120,
    80,
    110,
    90, // volatile window
    100,
    101,
    102,
    103,
    104,
    100,
    101,
    102,
    103,
    104,
  ]);
  const windows = buildWindows(bars, 5, 0);
  const sampling: WindowSamplingConfig = {
    mode: "stratified",
    stress_count: 1,
    buckets: { volatility: 2, trend: 2, volume: 2 },
    seed: "seed",
  };
  const selected = selectWindows(windows, bars, sampling, 2);
  expect(selected.map((w) => w.window_id)).toContain("w0");
});
