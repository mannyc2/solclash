import { describe, test, expect } from "bun:test";
import { applyTrade, computeEquity } from "../accounting.js";
import type { AccountState } from "../types.js";

describe("applyTrade", () => {
  const flat: AccountState = {
    cash_balance: 10000,
    position_qty: 0,
    avg_entry_price: 0,
  };

  test("open long from flat", () => {
    const result = applyTrade(flat, 1, 100, 0.05);
    expect(result.account.position_qty).toBe(1);
    expect(result.account.avg_entry_price).toBe(100);
    expect(result.account.cash_balance).toBeCloseTo(10000 - 0.05, 10);
    expect(result.realized_pnl).toBe(0);
  });

  test("add to long (same direction)", () => {
    const long: AccountState = {
      cash_balance: 9000,
      position_qty: 1,
      avg_entry_price: 100,
    };
    const result = applyTrade(long, 1, 110, 0);
    expect(result.account.position_qty).toBe(2);
    // Weighted avg: (1*100 + 1*110)/2 = 105
    expect(result.account.avg_entry_price).toBe(105);
    expect(result.realized_pnl).toBe(0);
  });

  test("partial close long", () => {
    const long: AccountState = {
      cash_balance: 9000,
      position_qty: 2,
      avg_entry_price: 100,
    };
    // Sell 1 at 110 → realized_pnl = 1 * (110 - 100) * 1 = 10
    const result = applyTrade(long, -1, 110, 0);
    expect(result.account.position_qty).toBe(1);
    expect(result.account.avg_entry_price).toBe(100); // unchanged
    expect(result.realized_pnl).toBe(10);
    expect(result.account.cash_balance).toBe(9010);
  });

  test("full close long", () => {
    const long: AccountState = {
      cash_balance: 9000,
      position_qty: 1,
      avg_entry_price: 100,
    };
    const result = applyTrade(long, -1, 120, 0.06);
    expect(result.account.position_qty).toBe(0);
    expect(result.account.avg_entry_price).toBe(0);
    // realized_pnl = 1*(120-100)*1 = 20, cash = 9000 + 20 - 0.06
    expect(result.realized_pnl).toBe(20);
    expect(result.account.cash_balance).toBeCloseTo(9019.94, 10);
  });

  test("flip from long to short", () => {
    const long: AccountState = {
      cash_balance: 9000,
      position_qty: 1,
      avg_entry_price: 100,
    };
    // Sell 2: close 1 at profit, open 1 short at 110
    const result = applyTrade(long, -2, 110, 0);
    expect(result.account.position_qty).toBe(-1);
    expect(result.account.avg_entry_price).toBe(110);
    // realized_pnl = 1 * (110 - 100) * 1 = 10
    expect(result.realized_pnl).toBe(10);
    expect(result.account.cash_balance).toBe(9010);
  });

  test("short position partial close", () => {
    const short: AccountState = {
      cash_balance: 9000,
      position_qty: -2,
      avg_entry_price: 100,
    };
    // Buy 1 at 90 → close 1 short → realized = 1*(90-100)*(-1) = 10
    const result = applyTrade(short, 1, 90, 0);
    expect(result.account.position_qty).toBe(-1);
    expect(result.realized_pnl).toBe(10);
  });

  test("zero delta is no-op", () => {
    const result = applyTrade(flat, 0, 100, 0);
    expect(result.account).toEqual(flat);
    expect(result.realized_pnl).toBe(0);
  });
});

describe("computeEquity", () => {
  test("flat position", () => {
    expect(
      computeEquity({ cash_balance: 10000, position_qty: 0, avg_entry_price: 0 }, 100),
    ).toBe(10000);
  });

  test("long position", () => {
    expect(
      computeEquity({ cash_balance: 9000, position_qty: 1, avg_entry_price: 100 }, 110),
    ).toBe(9110);
  });

  test("short position with loss", () => {
    // cash=9000, pos=-1, mark=110 → equity=9000 + (-1)*110 = 8890
    expect(
      computeEquity({ cash_balance: 9000, position_qty: -1, avg_entry_price: 100 }, 110),
    ).toBe(8890);
  });
});
