import { describe, test, expect } from "bun:test";
import { computeWindowMetrics, computeScore } from "../metrics.js";

describe("computeWindowMetrics", () => {
  test("flat equity curve", () => {
    const curve = Array.from({ length: 5 }, () => ({
      equity: 10000,
      notional_exposure: 0,
    }));
    const m = computeWindowMetrics("w1", curve, 0, 0);
    expect(m.pnl).toBe(0);
    expect(m.drawdown).toBe(0);
    expect(m.exposure).toBe(0);
  });

  test("rising equity", () => {
    const curve = [
      { equity: 10000, notional_exposure: 100 },
      { equity: 10050, notional_exposure: 105 },
      { equity: 10100, notional_exposure: 110 },
    ];
    const m = computeWindowMetrics("w2", curve, 5, 0);
    expect(m.pnl).toBe(100);
    expect(m.drawdown).toBe(0);
    expect(m.exposure).toBeCloseTo(105, 5);
    expect(m.total_fees).toBe(5);
  });

  test("drawdown calculated correctly", () => {
    const curve = [
      { equity: 10000, notional_exposure: 100 },
      { equity: 10200, notional_exposure: 100 }, // peak
      { equity: 10100, notional_exposure: 100 }, // dd = 100
      { equity: 10150, notional_exposure: 100 },
    ];
    const m = computeWindowMetrics("w3", curve, 0, 0);
    expect(m.drawdown).toBe(100);
    expect(m.peak_equity).toBe(10200);
    expect(m.trough_equity).toBe(10100);
  });
});

describe("computeScore", () => {
  test("scoring formula", () => {
    const metrics = {
      window_id: "w1",
      pnl: 100,
      drawdown: 50,
      exposure: 200,
      total_fees: 5,
      liquidation_count: 0,
      equity_start: 10000,
      equity_end: 10100,
      peak_equity: 10100,
      trough_equity: 10050,
    };
    const weights = { pnl: 1, drawdown: -0.5, exposure: -0.1 };
    // 1*100 + (-0.5)*50 + (-0.1)*200 = 100 - 25 - 20 = 55
    expect(computeScore(metrics, weights)).toBe(55);
  });
});
