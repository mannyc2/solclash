import type { AccountState } from "./types.js";

export interface TradeResult {
  account: AccountState;
  realized_pnl: number;
  fee: number;
}

export function applyTrade(
  account: AccountState,
  deltaQty: number,
  execPrice: number,
  fee: number,
): TradeResult {
  if (deltaQty === 0) {
    return { account: { ...account }, realized_pnl: 0, fee };
  }

  const { cash_balance, position_qty, avg_entry_price } = account;
  let realizedPnl = 0;
  let newPositionQty = position_qty + deltaQty;
  let newAvgEntry = avg_entry_price;

  const sameDirection =
    position_qty === 0 ||
    (position_qty > 0 && deltaQty > 0) ||
    (position_qty < 0 && deltaQty < 0);

  if (sameDirection) {
    // Adding to position: weighted average entry
    const totalQty = Math.abs(position_qty) + Math.abs(deltaQty);
    newAvgEntry =
      (Math.abs(position_qty) * avg_entry_price +
        Math.abs(deltaQty) * execPrice) /
      totalQty;
  } else {
    // Reducing or flipping position
    const closedQty = Math.min(Math.abs(position_qty), Math.abs(deltaQty));
    const posSign = position_qty > 0 ? 1 : -1;
    realizedPnl = closedQty * (execPrice - avg_entry_price) * posSign;

    if (Math.abs(deltaQty) >= Math.abs(position_qty)) {
      // Full close or flip
      if (Math.abs(deltaQty) > Math.abs(position_qty)) {
        // Flip: remainder opens at exec price
        newAvgEntry = execPrice;
      } else {
        // Exact close
        newAvgEntry = 0;
      }
    }
    // Partial close: avg_entry stays the same
  }

  const newCash = cash_balance + realizedPnl - fee;

  return {
    account: {
      cash_balance: newCash,
      position_qty: newPositionQty,
      avg_entry_price: newAvgEntry,
    },
    realized_pnl: realizedPnl,
    fee,
  };
}

export function computeEquity(
  account: AccountState,
  markPrice: number,
): number {
  return account.cash_balance + account.position_qty * markPrice;
}
