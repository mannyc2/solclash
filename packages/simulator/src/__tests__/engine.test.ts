import { describe, test, expect } from "bun:test";
import { runWindow } from "../engine.js";
import { BUY_AND_HOLD, FLAT } from "../baselines.js";
import { ActionType } from "../types.js";
import type { ArenaConfig, OhlcvBar } from "../types.js";

function makeBars(prices: number[]): OhlcvBar[] {
  return prices.map((p, i) => ({
    symbol: "BTC-PERP",
    bar_start_ts_ms: i * 60000,
    bar_end_ts_ms: (i + 1) * 60000,
    open: p,
    high: p * 1.01,
    low: p * 0.99,
    close: p,
    volume: 100,
  }));
}

const config: ArenaConfig = {
  arena_id: "test",
  symbol: "BTC-PERP",
  base_mint: "BTC",
  quote_mint: "USDC",
  bar_interval_seconds: 60,
  price_scale: 1_000_000,
  volume_scale: 1_000_000,
  tape_source: { type: "historical", dataset_id: "test" },
  window_duration_bars: 10,
  max_window_overlap_pct: 0,
  number_of_windows_per_round: 1,
  window_sampling: {
    mode: "sequential",
    stress_count: 1,
    buckets: { volatility: 3, trend: 3, volume: 3 },
  },
  lookback_len: 5,
  slippage_bps: 0,
  impact_k_bps: 0,
  impact_cap_bps: 50,
  liquidity_multiplier: 1.0,
  min_liquidity: 1,
  taker_fee_bps: 0,
  initial_margin_bps: 1000,
  maintenance_margin_bps: 500,
  max_leverage_bps: 10000,
  liquidation_fee_bps: 50,
  funding_rate_bps_per_bar: 0,
  initial_balances: [{ mint: "USDC", amount: 10000 }],
  scoring_weights: { pnl: 1, drawdown: -0.5, exposure: -0.1 },
  scoring_weights_reference: "docs/scoring-weights.json",
  baseline_bots_enabled: ["BUY_AND_HOLD", "FLAT"],
};

describe("engine", () => {
  test("FLAT baseline: no trades, equity stays at 10000", async () => {
    const bars = makeBars([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    const result = await runWindow(config, bars, "w1", [
      { id: "flat", policy: FLAT },
    ]);
    const flat = result.agent_results["flat"]!;

    expect(flat.trade_log).toHaveLength(0);
    expect(flat.final_account.position_qty).toBe(0);
    expect(flat.final_account.cash_balance).toBe(10000);
    expect(flat.metrics.pnl).toBe(0);
  });

  test("BUY_AND_HOLD: buys 1 at bar 1 open, holds to end", async () => {
    // Prices: all 100, so open=close=100 everywhere
    const bars = makeBars([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    const result = await runWindow(config, bars, "w2", [
      { id: "bah", policy: BUY_AND_HOLD },
    ]);
    const bah = result.agent_results["bah"]!;

    // BUY at step 0 → exec at bar 1 open = 100 (0 slippage, 0 fee)
    expect(bah.trade_log).toHaveLength(1);
    expect(bah.trade_log[0]!.delta_qty).toBe(1);
    expect(bah.final_account.position_qty).toBe(1);
    // equity_start (step 0, flat) = 10000
    // equity_end (step 9, 1 BTC @ 100) = 10000 + 100 = 10100
    // pnl = 10100 - 10000 = 100 (unrealized position value)
    expect(bah.metrics.pnl).toBe(100);
  });

  test("BUY_AND_HOLD with rising prices", async () => {
    const bars = makeBars([100, 100, 110, 110, 110, 110, 110, 110, 110, 120]);
    const result = await runWindow(config, bars, "w3", [
      { id: "bah", policy: BUY_AND_HOLD },
    ]);
    const bah = result.agent_results["bah"]!;

    // Buy 1 at bar1 open = 100, final close = 120
    // equity_end = 10000 + 1*(120) - 1*100 = 10020
    // Wait, cash stays 10000 (no fee), pos=1, avg_entry=100
    // equity at step 9 = 10000 + 1*120 = 10120... but that's not right
    // Actually: buy 1 at 100, cash = 10000 (no deduction for perps), equity = cash + pos*mark
    // Cash stays 10000 because realized_pnl=0 (just opening), fee=0
    // equity_end = 10000 + 1*120 = 10120
    // equity_start = 10000 + 0*100 = 10000 (no position at step 0)
    // pnl = 10120 - 10000 = 120
    // No wait - at step 0, action is BUY, exec at bar1 open=100
    // step 0: no position yet, equity = 10000, mark=100
    // step 1: position=1, avg_entry=100, cash=10000, mark=100, equity=10100
    // ...
    // step 9: pos=1, cash=10000, mark=120, equity=10120

    expect(bah.metrics.pnl).toBeCloseTo(120, 5);
    expect(bah.metrics.equity_start).toBe(10000);
    expect(bah.metrics.equity_end).toBeCloseTo(10120, 5);
  });

  test("slippage and fees apply correctly", async () => {
    const cfgWithFees: ArenaConfig = {
      ...config,
      slippage_bps: 5,
      taker_fee_bps: 5,
    };
    const bars = makeBars([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    const result = await runWindow(cfgWithFees, bars, "w4", [
      { id: "bah", policy: BUY_AND_HOLD },
    ]);
    const bah = result.agent_results["bah"]!;

    // exec_price = 100 * (1 + 5/10000) = 100.05
    // fee = 1 * 100.05 * 5/10000 = 0.050025
    expect(bah.trade_log[0]!.exec_price).toBeCloseTo(100.05, 10);
    expect(bah.trade_log[0]!.fee_paid).toBeCloseTo(0.050025, 10);
  });

  test("opposite trades net to zero impact", async () => {
    const bars = makeBars([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    const buy = (input: any) => ({
      version: 1,
      action_type: ActionType.BUY,
      order_qty: 1,
      err_code: 0,
    });
    const sell = (input: any) => ({
      version: 1,
      action_type: ActionType.SELL,
      order_qty: 1,
      err_code: 0,
    });
    const result = await runWindow(config, bars, "w5", [
      { id: "buy", policy: buy },
      { id: "sell", policy: sell },
    ]);
    const buyRes = result.agent_results["buy"]!;
    const sellRes = result.agent_results["sell"]!;

    expect(buyRes.trade_log[0]!.exec_price).toBeCloseTo(100, 10);
    expect(buyRes.trade_log[0]!.impact_bps).toBe(0);
    expect(buyRes.trade_log[0]!.net_qty).toBe(0);
    expect(sellRes.trade_log[0]!.exec_price).toBeCloseTo(100, 10);
  });

  test("same-side trades incur impact", async () => {
    const cfgWithImpact: ArenaConfig = {
      ...config,
      impact_k_bps: 100,
      slippage_bps: 0,
    };
    const bars = makeBars([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    const buy = (input: any) => ({
      version: 1,
      action_type: ActionType.BUY,
      order_qty: 1,
      err_code: 0,
    });
    const result = await runWindow(cfgWithImpact, bars, "w6", [
      { id: "buy1", policy: buy },
      { id: "buy2", policy: buy },
    ]);
    const buy1 = result.agent_results["buy1"]!;
    // net_qty = 2, volume = 100, impact_k_bps = 100 => impact_bps = 2
    expect(buy1.trade_log[0]!.impact_bps).toBeCloseTo(2, 10);
    expect(buy1.trade_log[0]!.exec_price).toBeCloseTo(100.02, 6);
  });

  test("rejects trades that would fail initial margin at execution price", async () => {
    const bars = makeBars([100, 100]);
    const shortTooBig = (input: any) =>
      input.step_index === 0
        ? {
            version: 1,
            action_type: ActionType.SELL,
            order_qty: 200,
            err_code: 0,
          }
        : {
            version: 1,
            action_type: ActionType.HOLD,
            order_qty: 0,
            err_code: 0,
          };

    const result = await runWindow(config, bars, "w7", [
      { id: "short", policy: shortTooBig },
    ]);
    const short = result.agent_results["short"]!;

    expect(short.trade_log).toHaveLength(0);
    expect(short.final_account.position_qty).toBe(0);
    expect(short.policy_log[0]!.status).toBe("ERR");
    expect(short.policy_log[0]!.err_code).toBe(6);
    expect(short.policy_log[0]!.action_type).toBe(ActionType.HOLD);
  });

  test("rejects trades that would exceed max leverage at execution price", async () => {
    const bars = makeBars([100, 100]);
    const cfgWithLeverageCap: ArenaConfig = {
      ...config,
      max_leverage_bps: 5000,
    };
    const shortMedium = (input: any) =>
      input.step_index === 0
        ? {
            version: 1,
            action_type: ActionType.SELL,
            order_qty: 50,
            err_code: 0,
          }
        : {
            version: 1,
            action_type: ActionType.HOLD,
            order_qty: 0,
            err_code: 0,
          };

    const result = await runWindow(cfgWithLeverageCap, bars, "w8", [
      { id: "short", policy: shortMedium },
    ]);
    const short = result.agent_results["short"]!;

    expect(short.trade_log).toHaveLength(0);
    expect(short.final_account.position_qty).toBe(0);
    expect(short.policy_log[0]!.status).toBe("ERR");
    expect(short.policy_log[0]!.err_code).toBe(6);
    expect(short.policy_log[0]!.action_type).toBe(ActionType.HOLD);
  });
});
