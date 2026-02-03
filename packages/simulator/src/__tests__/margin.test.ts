import { describe, test, expect } from "bun:test";
import { checkMargin, checkInitialMargin, checkMaxLeverage, liquidate } from "../margin.js";
import type { AccountState } from "../types.js";

describe("checkMargin", () => {
  test("healthy position not liquidated", () => {
    const account: AccountState = {
      cash_balance: 9000,
      position_qty: 1,
      avg_entry_price: 100,
    };
    // equity = 9000 + 1*100 = 9100
    // notional = 100, maint margin = 100 * 500/10000 = 5
    const result = checkMargin(account, 100, 500);
    expect(result.is_liquidated).toBe(false);
    expect(result.equity).toBe(9100);
    expect(result.maintenance_margin).toBe(5);
  });

  test("underwater position is liquidated", () => {
    const account: AccountState = {
      cash_balance: 10,
      position_qty: 1,
      avg_entry_price: 100,
    };
    // equity = 10 + 1*50 = 60
    // notional = 50, maint margin = 50 * 500/10000 = 2.5
    // equity 60 > 2.5, not liquidated
    const result = checkMargin(account, 50, 500);
    expect(result.is_liquidated).toBe(false);

    // Now with very thin margin
    const thin: AccountState = {
      cash_balance: 1,
      position_qty: 10,
      avg_entry_price: 100,
    };
    // equity = 1 + 10*90 = 901
    // notional = 900, maint margin = 900 * 500/10000 = 45
    // 901 > 45, not liquidated yet
    const r2 = checkMargin(thin, 90, 500);
    expect(r2.is_liquidated).toBe(false);

    // Extreme: equity < maintenance
    const failing: AccountState = {
      cash_balance: -100,
      position_qty: 1,
      avg_entry_price: 100,
    };
    // equity = -100 + 1*50 = -50
    // notional = 50, maint = 50*500/10000 = 2.5
    // -50 < 2.5 → liquidated
    const r3 = checkMargin(failing, 50, 500);
    expect(r3.is_liquidated).toBe(true);
  });

  test("flat position is never liquidated", () => {
    const account: AccountState = {
      cash_balance: 0,
      position_qty: 0,
      avg_entry_price: 0,
    };
    const result = checkMargin(account, 100, 500);
    expect(result.is_liquidated).toBe(false);
  });
});

describe("checkInitialMargin", () => {
  test("requires equity to cover initial margin", () => {
    const account: AccountState = {
      cash_balance: 10000,
      position_qty: -50,
      avg_entry_price: 100,
    };
    // notional = 50 * 100 = 5000
    // equity = 10000 - 5000 = 5000
    // required margin (10%) = 500
    const ok = checkInitialMargin(account, 100, 1000);
    expect(ok.ok).toBe(true);

    const failing: AccountState = {
      cash_balance: 1000,
      position_qty: -50,
      avg_entry_price: 100,
    };
    // equity = 1000 - 5000 = -4000 < required margin
    const bad = checkInitialMargin(failing, 100, 1000);
    expect(bad.ok).toBe(false);
  });
});

describe("checkMaxLeverage", () => {
  test("caps notional relative to equity", () => {
    const account: AccountState = {
      cash_balance: 10000,
      position_qty: -50,
      avg_entry_price: 100,
    };
    // equity = 5000, notional = 5000, leverage = 1x
    const ok = checkMaxLeverage(account, 100, 10_000);
    expect(ok.ok).toBe(true);

    const capped = checkMaxLeverage(account, 100, 5_000);
    expect(capped.ok).toBe(false);
  });
});

describe("liquidate", () => {
  test("liquidates long position", () => {
    const account: AccountState = {
      cash_balance: 100,
      position_qty: 2,
      avg_entry_price: 50,
    };
    // Liquidate at next bar open = 45
    // realized_pnl = 2 * (45 - 50) * 1 = -10
    // notional = 2 * 45 = 90
    // liq_fee = 90 * 50/10000 = 0.45
    // new cash = 100 + (-10) - 0.45 = 89.55
    const result = liquidate(account, 45, 50);
    expect(result.liquidated_qty).toBe(2);
    expect(result.exec_price).toBe(45);
    expect(result.liquidation_fee).toBeCloseTo(0.45, 10);
    expect(result.account.position_qty).toBe(0);
    expect(result.account.avg_entry_price).toBe(0);
    expect(result.account.cash_balance).toBeCloseTo(89.55, 10);
  });
});
