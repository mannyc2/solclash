import { describe, expect, test } from "bun:test";
import { loadTapeFromJson, loadTapeFromJsonl } from "../loader.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

describe("loader", () => {
  test("loads instrument metadata from JSON object", async () => {
    const dir = join("/tmp", `solclash-${randomUUID()}`);
    await Bun.spawn(["mkdir", "-p", dir]).exited;
    const path = join(dir, "bars.json");
    const payload = {
      instrument: {
        symbol: "BTC-PERP",
        base_mint: "BTC",
        quote_mint: "USDC",
        price_scale: 1000000,
        volume_scale: 1000000,
      },
      bars: [
        {
          symbol: "BTC-PERP",
          bar_start_ts_ms: 0,
          bar_end_ts_ms: 60000,
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 10,
        },
      ],
    };
    await Bun.write(path, JSON.stringify(payload));

    const tape = await loadTapeFromJson(path);
    expect(tape.instrument?.symbol).toBe("BTC-PERP");
    expect(tape.bars).toHaveLength(1);
  });

  test("loads raw bar array JSON", async () => {
    const dir = join("/tmp", `solclash-${randomUUID()}`);
    await Bun.spawn(["mkdir", "-p", dir]).exited;
    const path = join(dir, "bars.json");
    const payload = [
      {
        symbol: "BTC-PERP",
        bar_start_ts_ms: 0,
        bar_end_ts_ms: 60000,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 10,
      },
    ];
    await Bun.write(path, JSON.stringify(payload));

    const tape = await loadTapeFromJson(path);
    expect(tape.instrument).toBeUndefined();
    expect(tape.bars).toHaveLength(1);
  });

  test("loads instrument metadata from JSONL header", async () => {
    const dir = join("/tmp", `solclash-${randomUUID()}`);
    await Bun.spawn(["mkdir", "-p", dir]).exited;
    const path = join(dir, "bars.jsonl");
    const header = JSON.stringify({
      instrument: {
        symbol: "ETH-PERP",
        base_mint: "ETH",
        quote_mint: "USDC",
        price_scale: 1000000,
        volume_scale: 1000000,
      },
    });
    const bar = JSON.stringify({
      symbol: "ETH-PERP",
      bar_start_ts_ms: 0,
      bar_end_ts_ms: 60000,
      open: 200,
      high: 201,
      low: 199,
      close: 200,
      volume: 5,
    });
    await Bun.write(path, `${header}\n${bar}\n`);

    const tape = await loadTapeFromJsonl(path);
    expect(tape.instrument?.symbol).toBe("ETH-PERP");
    expect(tape.bars).toHaveLength(1);
  });
});
