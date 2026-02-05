import { z } from "zod";

// --- Bar & Instrument ---

export interface OhlcvBar {
  symbol: string;
  bar_start_ts_ms: number;
  bar_end_ts_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface InstrumentMeta {
  symbol: string;
  base_mint: string;
  quote_mint: string;
  price_scale: number;
  volume_scale: number;
}

// --- Account ---

export interface AccountState {
  cash_balance: number;
  position_qty: number;
  avg_entry_price: number;
}

// --- Action & Eval ---

export enum ActionType {
  HOLD = 0,
  BUY = 1,
  SELL = 2,
  CLOSE = 3,
}

export interface EvalInputV1 {
  version: 1;
  window_id: string;
  step_index: number;
  bar_interval_seconds: number;
  lookback_len: number;
  instrument: InstrumentMeta;
  account: AccountState;
  max_leverage_bps: number;
  initial_margin_bps: number;
  maintenance_margin_bps: number;
  ohlcv: OhlcvBar[];
}

export interface EvalOutputV1 {
  version: 1;
  action_type: ActionType;
  order_qty: number;
  err_code: number;
}

// --- Policy ---

export type PolicyFn = (
  input: EvalInputV1,
) => EvalOutputV1 | Promise<EvalOutputV1>;

export interface AgentPolicy {
  id: string;
  policy: PolicyFn;
}

// --- Config ---

const BalanceEntrySchema = z.object({
  mint: z.string(),
  amount: z.number().nonnegative(),
});

export const ScoringWeightsSchema = z.object({
  pnl: z.number(),
  drawdown: z.number(),
  exposure: z.number(),
});

const HistoricalTapeSourceBaseSchema = z.object({
  type: z.literal("historical"),
  dataset_id: z.string().optional(),
  path: z.string().optional(),
  bar_interval_seconds: z.number().int().positive().optional(),
});

const SyntheticTapeSourceSchema = z.object({
  type: z.literal("synthetic"),
  generator_id: z.string(),
  seed: z.number().int(),
  params: z.record(z.any()).optional().default({}),
});

const TapeSourceSchema = z
  .discriminatedUnion("type", [
    HistoricalTapeSourceBaseSchema,
    SyntheticTapeSourceSchema,
  ])
  .superRefine((v, ctx) => {
    if (v.type === "historical" && !v.dataset_id && !v.path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "historical tape_source requires dataset_id or path",
      });
    }
  });

const WindowSamplingSchema = z
  .object({
    // Defaults keep configs compact while still deterministic across runs.
    mode: z.enum(["sequential", "stratified"]).default("sequential"),
    stress_count: z.number().int().min(0).default(1),
    buckets: z
      .object({
        volatility: z.number().int().positive().default(3),
        trend: z.number().int().positive().default(3),
        volume: z.number().int().positive().default(3),
      })
      .default({ volatility: 3, trend: 3, volume: 3 }),
    seed: z.string().optional(),
  })
  .default({});

export const ArenaConfigSchema = z
  .object({
    arena_id: z.string(),
    symbol: z.string(),
    base_mint: z.string(),
    quote_mint: z.string(),
    bar_interval_seconds: z.number().int().nonnegative(),
    price_scale: z.number().int().positive().default(1_000_000),
    volume_scale: z.number().int().positive().default(1_000_000),
    tape_source: TapeSourceSchema.optional(),
    window_duration_bars: z.number().int().positive(),
    max_window_overlap_pct: z.number().int().min(0).max(100),
    number_of_windows_per_round: z.number().int().positive(),
    window_sampling: WindowSamplingSchema,
    lookback_len: z.number().int().nonnegative(),
    slippage_bps: z.number().int().nonnegative(),
    impact_k_bps: z.number().int().nonnegative(),
    impact_cap_bps: z.number().int().nonnegative().optional(),
    liquidity_multiplier: z.number().positive(),
    min_liquidity: z.number().int().nonnegative(),
    taker_fee_bps: z.number().int().nonnegative(),
    initial_margin_bps: z.number().int().nonnegative(),
    maintenance_margin_bps: z.number().int().nonnegative(),
    max_leverage_bps: z.number().int().min(10000),
    liquidation_fee_bps: z.number().int().nonnegative(),
    funding_rate_bps_per_bar: z.number().int().nonnegative(),
    initial_balances: z.array(BalanceEntrySchema).min(1),
    scoring_weights: ScoringWeightsSchema.optional(),
    scoring_weights_reference: z.string().default("docs/scoring-weights.json"),
    baseline_bots_enabled: z.array(z.string()),
    compute_unit_limit: z.number().int().positive().optional(),
  })
  .refine((c) => c.maintenance_margin_bps <= c.initial_margin_bps, {
    message: "maintenance_margin_bps must be <= initial_margin_bps",
  })
  .refine((c) => c.lookback_len < c.window_duration_bars, {
    message: "lookback_len must be < window_duration_bars",
  })
  .refine((c) => c.initial_balances.some((b) => b.mint === c.quote_mint), {
    message: "initial_balances must include quote_mint",
  });

export type ScoringWeights = z.infer<typeof ScoringWeightsSchema>;
export type TapeSource = z.infer<typeof TapeSourceSchema>;
export type WindowSamplingConfig = z.infer<typeof WindowSamplingSchema>;
export type ArenaConfig = z.infer<typeof ArenaConfigSchema>;
// Represents a config after scoring weights have been resolved from a reference.
export type ArenaConfigResolved = ArenaConfig & {
  scoring_weights: ScoringWeights;
};

// --- Metrics ---

export interface WindowMetrics {
  window_id: string;
  pnl: number;
  drawdown: number;
  exposure: number;
  total_fees: number;
  liquidation_count: number;
  equity_start: number;
  equity_end: number;
  peak_equity: number;
  trough_equity: number;
}

export interface RoundMetrics {
  pnl_total: number;
  drawdown_max: number;
  exposure_avg: number;
  score: number;
  weights: ScoringWeights;
  window_metrics: WindowMetrics[];
}

// --- Logs ---

export interface PolicyLogEntry {
  window_id: string;
  step_index: number;
  agent_id: string;
  action_type: ActionType;
  order_qty: number;
  status: "OK" | "ERR";
  err_code: number;
}

export interface TradeLogEntry {
  window_id: string;
  step_index: number;
  agent_id: string;
  delta_qty: number;
  exec_price: number;
  fee_paid: number;
  slippage_bps: number;
  impact_bps: number;
  net_qty: number;
}

export interface EquityLogEntry {
  window_id: string;
  step_index: number;
  equity: number;
  cash_balance: number;
  position_qty: number;
  mark_price: number;
}

export interface LiquidationLogEntry {
  window_id: string;
  step_index: number;
  agent_id: string;
  liquidated_qty: number;
  exec_price: number;
  liquidation_fee: number;
}

export interface WindowSummary {
  window_id: string;
  metrics_by_agent: Record<string, WindowMetrics>;
  invalid_window_reason: string | null;
}

// --- Window ---

export interface WindowDef {
  window_id: string;
  start_index: number;
  end_index: number;
}

export interface WindowAgentResult {
  metrics: WindowMetrics;
  equity_log: EquityLogEntry[];
  trade_log: TradeLogEntry[];
  policy_log: PolicyLogEntry[];
  liquidation_log: LiquidationLogEntry[];
  final_account: AccountState;
}

export interface WindowMultiResult {
  window_id: string;
  agent_results: Record<string, WindowAgentResult>;
}
