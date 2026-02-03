import type { AccountState } from "./types.js";

export function applyFunding(
  account: AccountState,
  markPrice: number,
  fundingRateBpsPerBar: number,
): AccountState {
  if (fundingRateBpsPerBar === 0 || account.position_qty === 0) {
    return { ...account };
  }
  const payment =
    account.position_qty * markPrice * (fundingRateBpsPerBar / 10_000);
  return {
    ...account,
    cash_balance: account.cash_balance - payment,
  };
}
