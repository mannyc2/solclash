import type { WindowMetrics, RoundMetrics, ScoringWeights } from "./types.js";
import { computeScore } from "./metrics.js";

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

export { computeScore };
