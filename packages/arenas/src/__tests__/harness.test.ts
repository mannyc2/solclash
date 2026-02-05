import { describe, test, expect } from "bun:test";
import { HarnessClient } from "../runtime/harness.js";
import type { EvalInputV1 } from "@solclash/simulator";
import { join } from "node:path";

describe("HarnessClient", () => {
  test("eval returns HOLD output", async () => {
    const harnessPath = process.execPath;
    const scriptPath = join(import.meta.dir, "fixtures", "fake-harness.ts");

    const harness = await HarnessClient.start(
      harnessPath,
      [{ id: "agent-1", so_path: "/tmp/fake.so" }],
      200_000,
      [scriptPath],
    );

    const input: EvalInputV1 = {
      version: 1,
      window_id: "w0",
      step_index: 0,
      bar_interval_seconds: 60,
      lookback_len: 1,
      instrument: {
        symbol: "BTC-PERP",
        base_mint: "BTC",
        quote_mint: "USDC",
        price_scale: 1_000_000,
        volume_scale: 1_000_000,
      },
      account: {
        cash_balance: 10000,
        position_qty: 0,
        avg_entry_price: 0,
      },
      max_leverage_bps: 10000,
      initial_margin_bps: 1000,
      maintenance_margin_bps: 500,
      ohlcv: [
        {
          symbol: "BTC-PERP",
          bar_start_ts_ms: 0,
          bar_end_ts_ms: 60000,
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 100,
        },
      ],
    };

    const output = await harness.eval("agent-1", input);
    expect(output.action_type).toBe(0);
    expect(output.order_qty).toBe(0);

    await harness.shutdown();
  });

  test("propagates nonzero err_code when harness falls back to HOLD", async () => {
    const harnessPath = process.execPath;
    const scriptPath = join(import.meta.dir, "fixtures", "fake-harness-err.ts");

    const harness = await HarnessClient.start(
      harnessPath,
      [{ id: "agent-1", so_path: "/tmp/fake.so" }],
      200_000,
      [scriptPath],
    );

    const input: EvalInputV1 = {
      version: 1,
      window_id: "w0",
      step_index: 0,
      bar_interval_seconds: 60,
      lookback_len: 1,
      instrument: {
        symbol: "BTC-PERP",
        base_mint: "BTC",
        quote_mint: "USDC",
        price_scale: 1_000_000,
        volume_scale: 1_000_000,
      },
      account: {
        cash_balance: 10000,
        position_qty: 0,
        avg_entry_price: 0,
      },
      max_leverage_bps: 10000,
      initial_margin_bps: 1000,
      maintenance_margin_bps: 500,
      ohlcv: [
        {
          symbol: "BTC-PERP",
          bar_start_ts_ms: 0,
          bar_end_ts_ms: 60000,
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 100,
        },
      ],
    };

    const output = await harness.eval("agent-1", input);
    expect(output.action_type).toBe(0);
    expect(output.order_qty).toBe(0);
    expect(output.err_code).toBe(7);

    await harness.shutdown();
  });
});
