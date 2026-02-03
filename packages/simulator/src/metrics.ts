import type { WindowMetrics, ScoringWeights } from "./types.js";

export interface EquityPoint {
  equity: number;
  notional_exposure: number;
}

export function computeWindowMetrics(
  windowId: string,
  equityCurve: EquityPoint[],
  totalFees: number,
  liquidationCount: number,
): WindowMetrics {
  if (equityCurve.length === 0) {
    return {
      window_id: windowId,
      pnl: 0,
      drawdown: 0,
      exposure: 0,
      total_fees: 0,
      liquidation_count: 0,
      equity_start: 0,
      equity_end: 0,
      peak_equity: 0,
      trough_equity: 0,
    };
  }

  const equityStart = equityCurve[0]!.equity;
  const equityEnd = equityCurve[equityCurve.length - 1]!.equity;
  const pnl = equityEnd - equityStart;

  let peak = equityStart;
  let maxDrawdown = 0;
  let exposureSum = 0;

  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const dd = peak - point.equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
    exposureSum += point.notional_exposure;
  }

  const trough = peak - maxDrawdown;
  const exposure = exposureSum / equityCurve.length;

  return {
    window_id: windowId,
    pnl,
    drawdown: maxDrawdown,
    exposure,
    total_fees: totalFees,
    liquidation_count: liquidationCount,
    equity_start: equityStart,
    equity_end: equityEnd,
    peak_equity: peak,
    trough_equity: trough,
  };
}

export function computeScore(
  metrics: WindowMetrics,
  weights: ScoringWeights,
): number {
  return (
    weights.pnl * metrics.pnl +
    weights.drawdown * metrics.drawdown +
    weights.exposure * metrics.exposure
  );
}
