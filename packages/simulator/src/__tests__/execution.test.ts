import { describe, test, expect } from "bun:test";
import { computeExecPrice, computeFee } from "../execution.js";

describe("computeExecPrice", () => {
  test("buy adds slippage", () => {
    // open=100, buy, slippage=5bps → 100 * (1 + 5/10000) = 100.05
    expect(computeExecPrice(100, 1, 5)).toBeCloseTo(100.05, 10);
  });

  test("sell subtracts slippage", () => {
    // open=100, sell, slippage=5bps → 100 * (1 - 5/10000) = 99.95
    expect(computeExecPrice(100, -1, 5)).toBeCloseTo(99.95, 10);
  });

  test("zero slippage returns open price", () => {
    expect(computeExecPrice(50000, 1, 0)).toBe(50000);
    expect(computeExecPrice(50000, -1, 0)).toBe(50000);
  });
});

describe("computeFee", () => {
  test("fee on 1 BTC at 100.05 with 5bps", () => {
    // 1 * 100.05 * 5/10000 = 0.050025
    expect(computeFee(1, 100.05, 5)).toBeCloseTo(0.050025, 10);
  });

  test("zero fee_bps returns 0", () => {
    expect(computeFee(10, 50000, 0)).toBe(0);
  });
});
