// Re-export all types
export {
  ActionType,
  ArenaConfigSchema,
  BalanceEntrySchema,
  ScoringWeightsSchema,
  V1_DEFAULTS,
  TapeSourceSchema,
  HistoricalTapeSourceSchema,
  SyntheticTapeSourceSchema,
  WindowSamplingSchema,
} from "./types.js";
export type {
  OhlcvBar,
  InstrumentMeta,
  AccountState,
  EvalInputV1,
  EvalOutputV1,
  PolicyFn,
  AgentPolicy,
  ArenaConfig,
  ArenaConfigResolved,
  BalanceEntry,
  ScoringWeights,
  TapeSource,
  TapeSourceHistorical,
  TapeSourceSynthetic,
  WindowSamplingConfig,
  WindowMetrics,
  RoundMetrics,
  PolicyLogEntry,
  TradeLogEntry,
  EquityLogEntry,
  LiquidationLogEntry,
  WindowSummary,
  WindowDef,
  WindowAgentResult,
  WindowMultiResult,
} from "./types.js";

// Simulator modules
export {
  computeExecPrice,
  computeImpactBps,
  computeUniformExecPrice,
  computeFee,
} from "./execution.js";
export { applyTrade, computeEquity } from "./accounting.js";
export type { TradeResult } from "./accounting.js";
export { checkMargin, liquidate, liquidateAtPrice } from "./margin.js";
export type { MarginCheck, LiquidationResult } from "./margin.js";
export { applyFunding } from "./funding.js";
export { BUY_AND_HOLD, FLAT } from "./baselines.js";
export { runWindow } from "./engine.js";
export { computeWindowMetrics, computeScore } from "./metrics.js";
export type { EquityPoint } from "./metrics.js";
export { aggregateRound } from "./scoring.js";
