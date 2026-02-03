import type { AccountState } from "./types.js";
import { computeEquity } from "./accounting.js";

export interface MarginCheck {
  notional: number;
  equity: number;
  maintenance_margin: number;
  is_liquidated: boolean;
}

export interface InitialMarginCheck {
  notional: number;
  equity: number;
  required_margin: number;
  ok: boolean;
}

export interface MaxLeverageCheck {
  notional: number;
  equity: number;
  max_notional: number;
  ok: boolean;
}

export function checkMargin(
  account: AccountState,
  markPrice: number,
  maintenanceMarginBps: number,
): MarginCheck {
  const notional = Math.abs(account.position_qty) * markPrice;
  const equity = computeEquity(account, markPrice);
  const maintenance_margin = notional * (maintenanceMarginBps / 10_000);
  const is_liquidated = account.position_qty !== 0 && equity < maintenance_margin;

  return { notional, equity, maintenance_margin, is_liquidated };
}

export function checkInitialMargin(
  account: AccountState,
  markPrice: number,
  initialMarginBps: number,
): InitialMarginCheck {
  const notional = Math.abs(account.position_qty) * markPrice;
  const equity = computeEquity(account, markPrice);
  const required_margin = notional * (initialMarginBps / 10_000);
  const ok = notional === 0 || equity >= required_margin;
  return { notional, equity, required_margin, ok };
}

export function checkMaxLeverage(
  account: AccountState,
  markPrice: number,
  maxLeverageBps: number,
): MaxLeverageCheck {
  const notional = Math.abs(account.position_qty) * markPrice;
  const equity = computeEquity(account, markPrice);
  const max_notional = equity * (maxLeverageBps / 10_000);
  const ok = notional === 0 || (equity > 0 && notional <= max_notional);
  return { notional, equity, max_notional, ok };
}

export interface LiquidationResult {
  account: AccountState;
  liquidation_fee: number;
  liquidated_qty: number;
  exec_price: number;
}

export function liquidateAtPrice(
  account: AccountState,
  execPrice: number,
  liquidationFeeBps: number,
): LiquidationResult {
  const liquidated_qty = account.position_qty;
  const posSign = liquidated_qty > 0 ? 1 : -1;
  // Liquidation happens at next bar open (no slippage, but with liquidation fee)
  const exec_price = execPrice;
  const realized_pnl =
    Math.abs(liquidated_qty) * (exec_price - account.avg_entry_price) * posSign;
  const notional = Math.abs(liquidated_qty) * exec_price;
  const liquidation_fee = notional * (liquidationFeeBps / 10_000);

  return {
    account: {
      cash_balance: account.cash_balance + realized_pnl - liquidation_fee,
      position_qty: 0,
      avg_entry_price: 0,
    },
    liquidation_fee,
    liquidated_qty,
    exec_price,
  };
}

export function liquidate(
  account: AccountState,
  nextOpenPrice: number,
  liquidationFeeBps: number,
): LiquidationResult {
  return liquidateAtPrice(account, nextOpenPrice, liquidationFeeBps);
}
