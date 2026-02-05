import { describe, test, expect } from "bun:test";
import { applyFunding } from "../accounting.js";

describe("applyFunding", () => {
  test("no funding when rate is 0", () => {
    const account = {
      cash_balance: 10000,
      position_qty: 1,
      avg_entry_price: 100,
    };
    const result = applyFunding(account, 100, 0);
    expect(result.cash_balance).toBe(10000);
  });

  test("no funding when flat", () => {
    const account = {
      cash_balance: 10000,
      position_qty: 0,
      avg_entry_price: 0,
    };
    const result = applyFunding(account, 100, 10);
    expect(result.cash_balance).toBe(10000);
  });

  test("long pays funding", () => {
    const account = {
      cash_balance: 10000,
      position_qty: 1,
      avg_entry_price: 100,
    };
    // payment = 1 * 100 * 10/10000 = 0.1
    const result = applyFunding(account, 100, 10);
    expect(result.cash_balance).toBeCloseTo(9999.9, 10);
  });

  test("short receives funding (negative payment)", () => {
    const account = {
      cash_balance: 10000,
      position_qty: -1,
      avg_entry_price: 100,
    };
    // payment = -1 * 100 * 10/10000 = -0.1
    // cash -= -0.1 → cash = 10000.1
    const result = applyFunding(account, 100, 10);
    expect(result.cash_balance).toBeCloseTo(10000.1, 10);
  });
});
