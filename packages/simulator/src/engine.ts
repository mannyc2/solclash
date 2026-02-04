import type {
  OhlcvBar,
  AccountState,
  ArenaConfig,
  AgentPolicy,
  EvalInputV1,
  EvalOutputV1,
  EquityLogEntry,
  TradeLogEntry,
  PolicyLogEntry,
  LiquidationLogEntry,
  WindowAgentResult,
  WindowMultiResult,
} from "./types.js";
import { ActionType } from "./types.js";
import { computeUniformExecPrice, computeFee } from "./execution.js";
import { applyTrade, computeEquity } from "./accounting.js";
import {
  checkMargin,
  checkInitialMargin,
  checkMaxLeverage,
  liquidateAtPrice,
} from "./margin.js";
import { applyFunding } from "./funding.js";
import { computeWindowMetrics, type EquityPoint } from "./metrics.js";

interface StepAction {
  delta_qty: number;
  is_liquidation: boolean;
  output: EvalOutputV1;
  status: "OK" | "ERR";
}

function getRecordValue<T>(
  record: Record<string, T>,
  key: string,
  context: string,
): T {
  const value = record[key];
  if (value === undefined) {
    throw new Error(`${context}: missing key "${key}"`);
  }
  return value;
}

function getBarAt(bars: OhlcvBar[], index: number, context: string): OhlcvBar {
  const bar = bars[index];
  if (!bar) {
    throw new Error(`${context}: missing bar at index ${index}`);
  }
  return bar;
}

function normalizePolicyOutput(raw: unknown): EvalOutputV1 | null {
  if (!isRecord(raw)) {
    return null;
  }

  const version = toFiniteNumber(raw.version);
  const actionType = toFiniteNumber(raw.action_type);
  const orderQty = toFiniteNumber(raw.order_qty);
  const errCode = toFiniteNumber(raw.err_code);

  if (version !== 1) {
    return null;
  }
  if (actionType === null || !isActionType(actionType)) {
    return null;
  }
  if (orderQty === null) {
    return null;
  }
  if (
    (actionType === ActionType.BUY || actionType === ActionType.SELL) &&
    orderQty <= 0
  ) {
    return null;
  }

  return {
    version: 1,
    action_type: actionType,
    order_qty: orderQty,
    err_code: errCode ?? 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isActionType(value: number): value is ActionType {
  return (
    value === ActionType.HOLD ||
    value === ActionType.BUY ||
    value === ActionType.SELL ||
    value === ActionType.CLOSE
  );
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function runWindow(
  config: ArenaConfig,
  bars: OhlcvBar[],
  windowId: string,
  agents: AgentPolicy[],
): Promise<WindowMultiResult> {
  const initialCash =
    config.initial_balances.find((b) => b.mint === config.quote_mint)?.amount ??
    0;

  const holdOutput = (err_code: number): EvalOutputV1 => ({
    version: 1,
    action_type: ActionType.HOLD,
    order_qty: 0,
    err_code,
  });

  const agentState: Record<
    string,
    {
      account: AccountState;
      equityCurve: EquityPoint[];
      equityLog: EquityLogEntry[];
      tradeLog: TradeLogEntry[];
      policyLog: PolicyLogEntry[];
      liquidationLog: LiquidationLogEntry[];
      totalFees: number;
      liquidationCount: number;
    }
  > = {};

  for (const agent of agents) {
    agentState[agent.id] = {
      account: {
        cash_balance: initialCash,
        position_qty: 0,
        avg_entry_price: 0,
      },
      equityCurve: [],
      equityLog: [],
      tradeLog: [],
      policyLog: [],
      liquidationLog: [],
      totalFees: 0,
      liquidationCount: 0,
    };
  }

  for (let t = 0; t < bars.length; t++) {
    const bar = getBarAt(bars, t, "runWindow");
    const lookbackStart = Math.max(0, t - config.lookback_len + 1);
    const lookbackBars = bars.slice(lookbackStart, t + 1);

    const stepActions: Record<string, StepAction> = {};

    for (const agent of agents) {
      const state = getRecordValue(agentState, agent.id, "agent state");

      // 1. Apply funding
      state.account = applyFunding(
        state.account,
        bar.close,
        config.funding_rate_bps_per_bar,
      );

      const input: EvalInputV1 = {
        version: 1,
        window_id: windowId,
        step_index: t,
        bar_interval_seconds: config.bar_interval_seconds,
        lookback_len: lookbackBars.length,
        instrument: {
          symbol: config.symbol,
          base_mint: config.base_mint,
          quote_mint: config.quote_mint,
          price_scale: config.price_scale,
          volume_scale: config.volume_scale,
        },
        account: { ...state.account },
        max_leverage_bps: config.max_leverage_bps,
        initial_margin_bps: config.initial_margin_bps,
        maintenance_margin_bps: config.maintenance_margin_bps,
        ohlcv: lookbackBars,
      };

      // 2. Get agent action
      let output: EvalOutputV1;
      let status: "OK" | "ERR" = "OK";
      try {
        const rawOutput: unknown = await agent.policy(input);
        const normalized = normalizePolicyOutput(rawOutput);
        if (!normalized) {
          status = "ERR";
          output = holdOutput(6);
        } else {
          output = normalized;
        }
      } catch (_err) {
        // Treat policy failures as HOLD so a single agent can't abort the round.
        status = "ERR";
        output = holdOutput(5);
      }

      // 3. Convert action to delta_qty
      let deltaQty = 0;
      switch (output.action_type) {
        case ActionType.HOLD:
          deltaQty = 0;
          break;
        case ActionType.BUY:
          deltaQty = output.order_qty;
          break;
        case ActionType.SELL:
          deltaQty = -output.order_qty;
          break;
        case ActionType.CLOSE:
          deltaQty = -state.account.position_qty;
          break;
      }

      // 4. Mark-to-market at bar close (before executing the pending trade)
      const markPrice = bar.close;
      const equity = computeEquity(state.account, markPrice);
      const notionalExposure = Math.abs(state.account.position_qty) * markPrice;

      state.equityCurve.push({ equity, notional_exposure: notionalExposure });
      state.equityLog.push({
        window_id: windowId,
        step_index: t,
        equity,
        cash_balance: state.account.cash_balance,
        position_qty: state.account.position_qty,
        mark_price: markPrice,
      });

      // 5. Check margin at bar close (before trade execution)
      let isLiquidation = false;
      let finalDelta = deltaQty;
      if (state.account.position_qty !== 0) {
        const marginCheck = checkMargin(
          state.account,
          markPrice,
          config.maintenance_margin_bps,
        );
        if (marginCheck.is_liquidated) {
          isLiquidation = true;
          finalDelta = -state.account.position_qty;
        }
      }

      stepActions[agent.id] = {
        delta_qty: finalDelta,
        is_liquidation: isLiquidation,
        output,
        status,
      };
    }

    // 6. Execute at next bar open (if not last bar)
    if (t < bars.length - 1) {
      const nextBar = getBarAt(bars, t + 1, "execution");
      // Uniform execution uses net flow to apply transient impact without mutating the tape.
      const netQty = Object.values(stepActions).reduce(
        (sum, a) => sum + a.delta_qty,
        0,
      );
      const execInfo = computeUniformExecPrice(
        nextBar.open,
        netQty,
        config,
        nextBar.volume,
      );

      for (const agent of agents) {
        const action = getRecordValue(stepActions, agent.id, "step action");
        if (action.delta_qty === 0) {
          continue;
        }
        const state = getRecordValue(agentState, agent.id, "agent state");

        if (action.is_liquidation) {
          const liqResult = liquidateAtPrice(
            state.account,
            execInfo.exec_price,
            config.liquidation_fee_bps,
          );
          state.account = liqResult.account;
          state.totalFees += liqResult.liquidation_fee;
          state.liquidationCount++;
          state.liquidationLog.push({
            window_id: windowId,
            step_index: t,
            agent_id: agent.id,
            liquidated_qty: liqResult.liquidated_qty,
            exec_price: liqResult.exec_price,
            liquidation_fee: liqResult.liquidation_fee,
          });
        } else {
          const fee = computeFee(
            Math.abs(action.delta_qty),
            execInfo.exec_price,
            config.taker_fee_bps,
          );
          const tradeResult = applyTrade(
            state.account,
            action.delta_qty,
            execInfo.exec_price,
            fee,
          );
          const increasesExposure =
            Math.abs(tradeResult.account.position_qty) >
            Math.abs(state.account.position_qty);

          if (increasesExposure) {
            const marginCheck = checkInitialMargin(
              tradeResult.account,
              execInfo.exec_price,
              config.initial_margin_bps,
            );
            const leverageCheck = checkMaxLeverage(
              tradeResult.account,
              execInfo.exec_price,
              config.max_leverage_bps,
            );
            if (!marginCheck.ok || !leverageCheck.ok) {
              action.delta_qty = 0;
              action.status = "ERR";
              action.output = holdOutput(6);
              continue;
            }
          }

          state.account = tradeResult.account;
          state.totalFees += tradeResult.fee;

          state.tradeLog.push({
            window_id: windowId,
            step_index: t,
            agent_id: agent.id,
            delta_qty: action.delta_qty,
            exec_price: execInfo.exec_price,
            fee_paid: fee,
            slippage_bps: config.slippage_bps,
            impact_bps: execInfo.impact_bps,
            net_qty: netQty,
          });
        }
      }
    }

    for (const agent of agents) {
      const action = getRecordValue(stepActions, agent.id, "step action");
      const state = getRecordValue(agentState, agent.id, "agent state");
      state.policyLog.push({
        window_id: windowId,
        step_index: t,
        agent_id: agent.id,
        action_type: action.output.action_type,
        order_qty: action.output.order_qty,
        status: action.status,
        err_code: action.output.err_code,
      });
    }
  }

  const agentResults: Record<string, WindowAgentResult> = {};
  for (const agent of agents) {
    const state = getRecordValue(agentState, agent.id, "agent state");
    const metrics = computeWindowMetrics(
      windowId,
      state.equityCurve,
      state.totalFees,
      state.liquidationCount,
    );
    agentResults[agent.id] = {
      metrics,
      equity_log: state.equityLog,
      trade_log: state.tradeLog,
      policy_log: state.policyLog,
      liquidation_log: state.liquidationLog,
      final_account: state.account,
    };
  }

  return {
    window_id: windowId,
    agent_results: agentResults,
  };
}
