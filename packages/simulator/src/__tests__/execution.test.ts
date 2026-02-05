import { describe, test, expect } from "bun:test";
import { computeFee } from "../execution.js";

describe("computeFee", () => {
  test("fee on 1 BTC at 100.05 with 5bps", () => {
    // 1 * 100.05 * 5/10000 = 0.050025
    expect(computeFee(1, 100.05, 5)).toBeCloseTo(0.050025, 10);
  });

  test("zero fee_bps returns 0", () => {
    expect(computeFee(10, 50000, 0)).toBe(0);
  });
});
