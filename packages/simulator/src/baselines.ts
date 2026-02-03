import { ActionType, type PolicyFn } from "./types.js";

export const BUY_AND_HOLD: PolicyFn = (input) => {
  if (input.account.position_qty === 0) {
    return {
      version: 1,
      action_type: ActionType.BUY,
      order_qty: 1,
      err_code: 0,
    };
  }
  return {
    version: 1,
    action_type: ActionType.HOLD,
    order_qty: 0,
    err_code: 0,
  };
};

export const FLAT: PolicyFn = (_input) => ({
  version: 1,
  action_type: ActionType.HOLD,
  order_qty: 0,
  err_code: 0,
});
