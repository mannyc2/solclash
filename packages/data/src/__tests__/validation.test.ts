import { describe, test, expect } from "bun:test";
import { validateBars } from "../validation.js";
import type { OhlcvBar } from "@solclash/simulator";

function makeBar(i: number, overrides: Partial<OhlcvBar> = {}): OhlcvBar {
  return {
    symbol: "BTC-PERP",
    bar_start_ts_ms: i * 60000,
    bar_end_ts_ms: (i + 1) * 60000,
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    volume: 50,
    ...overrides,
  };
}

describe("validateBars", () => {
  test("valid bars produce no errors", () => {
    const bars = [makeBar(0), makeBar(1), makeBar(2)];
    expect(validateBars(bars, 60000)).toHaveLength(0);
  });

  test("negative open detected", () => {
    const bars = [makeBar(0, { open: -1 })];
    const errors = validateBars(bars, 60000);
    expect(errors.some((e) => e.field === "open")).toBe(true);
  });

  test("low > open detected", () => {
    const bars = [makeBar(0, { low: 101 })];
    const errors = validateBars(bars, 60000);
    expect(errors.some((e) => e.field === "low")).toBe(true);
  });

  test("high < close detected", () => {
    const bars = [makeBar(0, { high: 99 })];
    const errors = validateBars(bars, 60000);
    expect(errors.some((e) => e.field === "high")).toBe(true);
  });

  test("non-contiguous bars detected", () => {
    const bars = [makeBar(0), makeBar(2)]; // gap at index 1
    const errors = validateBars(bars, 60000);
    expect(errors.some((e) => e.field === "bar_start_ts_ms")).toBe(true);
  });

  test("negative volume detected", () => {
    const bars = [makeBar(0, { volume: -10 })];
    const errors = validateBars(bars, 60000);
    expect(errors.some((e) => e.field === "volume")).toBe(true);
  });
});
