import type { WindowMetrics, RoundMetrics, ScoringWeights } from "./types.js";

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

  const firstPoint = equityCurve[0];
  const lastPoint = equityCurve[equityCurve.length - 1];
  if (!firstPoint || !lastPoint) {
    throw new Error("equity curve must contain at least one point");
  }
  const equityStart = firstPoint.equity;
  const equityEnd = lastPoint.equity;
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

export function aggregateRound(
  windowMetrics: WindowMetrics[],
  weights: ScoringWeights,
): RoundMetrics {
  if (windowMetrics.length === 0) {
    return {
      pnl_total: 0,
      drawdown_max: 0,
      exposure_avg: 0,
      score: 0,
      weights,
      window_metrics: [],
    };
  }

  let pnlTotal = 0;
  let drawdownMax = 0;
  let exposureSum = 0;

  for (const wm of windowMetrics) {
    pnlTotal += wm.pnl;
    if (wm.drawdown > drawdownMax) drawdownMax = wm.drawdown;
    exposureSum += wm.exposure;
  }

  const exposureAvg = exposureSum / windowMetrics.length;
  const score =
    weights.pnl * pnlTotal +
    weights.drawdown * drawdownMax +
    weights.exposure * exposureAvg;

  return {
    pnl_total: pnlTotal,
    drawdown_max: drawdownMax,
    exposure_avg: exposureAvg,
    score,
    weights,
    window_metrics: windowMetrics,
  };
}
