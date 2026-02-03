import { type PolicyFn, ActionType } from "@solclash/simulator";

const policy: PolicyFn = (input) => {
  const bars = input.ohlcv;
  const latest = bars[bars.length - 1]!;
  const isBullish = latest.close > latest.open;
  return {
    version: 1 as const,
    action_type: isBullish ? ActionType.BUY : ActionType.SELL,
    order_qty: 1,
    err_code: 0,
  };
};

export default policy;
