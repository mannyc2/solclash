import { describe, test, expect } from "bun:test";
import { buildWindows, sliceBars } from "../windowing.js";
import type { OhlcvBar } from "@solclash/simulator";

function makeBars(n: number): OhlcvBar[] {
  return Array.from({ length: n }, (_, i) => ({
    symbol: "BTC-PERP",
    bar_start_ts_ms: i * 60000,
    bar_end_ts_ms: (i + 1) * 60000,
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    volume: 50,
  }));
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

describe("buildWindows", () => {
  test("no windows if bars < duration", () => {
    const bars = makeBars(5);
    expect(buildWindows(bars, 10, 0)).toHaveLength(0);
  });

  test("single window with exact fit", () => {
    const bars = makeBars(10);
    const windows = buildWindows(bars, 10, 0);
    expect(windows).toHaveLength(1);
    const firstWindow = requireValue(windows[0], "first window");
    expect(firstWindow.start_index).toBe(0);
    expect(firstWindow.end_index).toBe(9);
  });

  test("multiple non-overlapping windows", () => {
    const bars = makeBars(20);
    const windows = buildWindows(bars, 10, 0);
    expect(windows).toHaveLength(2);
    const firstWindow = requireValue(windows[0], "first window");
    const secondWindow = requireValue(windows[1], "second window");
    expect(firstWindow.start_index).toBe(0);
    expect(secondWindow.start_index).toBe(10);
  });

  test("overlapping windows (50%)", () => {
    const bars = makeBars(20);
    const windows = buildWindows(bars, 10, 50);
    // step = 10 * (1 - 0.5) = 5
    // windows: 0-9, 5-14, 10-19
    expect(windows).toHaveLength(3);
    const middleWindow = requireValue(windows[1], "middle window");
    expect(middleWindow.start_index).toBe(5);
  });
});

describe("sliceBars", () => {
  test("slices correctly", () => {
    const bars = makeBars(20);
    const sliced = sliceBars(bars, {
      window_id: "w0",
      start_index: 5,
      end_index: 14,
    });
    expect(sliced).toHaveLength(10);
    const firstBar = requireValue(sliced[0], "first sliced bar");
    expect(firstBar.bar_start_ts_ms).toBe(5 * 60000);
  });
});
