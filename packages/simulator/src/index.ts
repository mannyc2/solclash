// Re-export all types
export {
  ActionType,
  ArenaConfigSchema,
  ScoringWeightsSchema,
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
  ScoringWeights,
  TapeSource,
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
  computeImpactBps,
  computeUniformExecPrice,
  computeFee,
} from "./execution.js";
export { applyTrade, computeEquity, applyFunding } from "./accounting.js";
export type { TradeResult } from "./accounting.js";
export { checkMargin, liquidateAtPrice } from "./margin.js";
export type { MarginCheck, LiquidationResult } from "./margin.js";
export { runWindow } from "./engine.js";
export {
  computeWindowMetrics,
  computeScore,
  aggregateRound,
} from "./metrics.js";
export type { EquityPoint } from "./metrics.js";
