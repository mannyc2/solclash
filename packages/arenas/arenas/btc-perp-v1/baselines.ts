import { ActionType, type PolicyFn } from "@solclash/simulator";

export const BASELINES: Record<string, PolicyFn> = {
  BUY_AND_HOLD: (input) => {
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
  },

  FLAT: (_input) => ({
    version: 1,
    action_type: ActionType.HOLD,
    order_qty: 0,
    err_code: 0,
  }),
};
