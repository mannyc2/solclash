import { describe, test, expect, mock, afterAll } from "bun:test";
import { fetchKlines, fetchAllKlines } from "../binance.js";

function mockFetch(impl: (...args: unknown[]) => Promise<Response>) {
  globalThis.fetch = mock(impl) as unknown as typeof fetch;
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

// --- Unit tests with mocked fetch ---

describe("fetchKlines (mocked)", () => {
  const originalFetch = globalThis.fetch;

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("converts raw Binance kline to OhlcvBar", async () => {
    const fakeKline = [
      1499040000000,
      "100.50",
      "105.00",
      "99.00",
      "102.30",
      "500.25",
      1499040059999,
      "50000.00",
      100,
      "250.00",
      "25000.00",
      "0",
    ];

    mockFetch(() => Promise.resolve(new Response(JSON.stringify([fakeKline]))));

    const bars = await fetchKlines({ symbol: "BTCUSDT", interval: "1m" });

    expect(bars).toHaveLength(1);
    const bar = requireValue(bars[0], "first bar");
    expect(bar.symbol).toBe("BTCUSDT");
    expect(bar.bar_start_ts_ms).toBe(1499040000000);
    expect(bar.bar_end_ts_ms).toBe(1499040059999);
    expect(bar.open).toBe(100.5);
    expect(bar.high).toBe(105);
    expect(bar.low).toBe(99);
    expect(bar.close).toBe(102.3);
    expect(bar.volume).toBe(500.25);
  });

  test("throws on non-ok response", async () => {
    mockFetch(() =>
      Promise.resolve(new Response('{"code":-1100}', { status: 400 })),
    );

    expect(fetchKlines({ symbol: "BAD", interval: "1m" })).rejects.toThrow(
      "Binance API error 400",
    );
  });

  test("passes startTime, endTime, and limit as query params", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url as string;
      return Promise.resolve(new Response("[]"));
    });

    await fetchKlines({
      symbol: "ETHUSDT",
      interval: "5m",
      startTime: 1000,
      endTime: 2000,
      limit: 500,
    });

    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get("symbol")).toBe("ETHUSDT");
    expect(parsed.searchParams.get("interval")).toBe("5m");
    expect(parsed.searchParams.get("startTime")).toBe("1000");
    expect(parsed.searchParams.get("endTime")).toBe("2000");
    expect(parsed.searchParams.get("limit")).toBe("500");
  });
});

describe("fetchAllKlines (mocked)", () => {
  const originalFetch = globalThis.fetch;

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("paginates through multiple requests", async () => {
    let callCount = 0;

    const pages = [
      // Page 1: 2 bars
      [
        [1000, "100", "101", "99", "100", "10", 1999, "0", 0, "0", "0", "0"],
        [2000, "100", "101", "99", "100", "10", 2999, "0", 0, "0", "0", "0"],
      ],
      // Page 2: 1 bar
      [[3000, "100", "101", "99", "100", "10", 3999, "0", 0, "0", "0", "0"]],
      // Page 3: empty → stop
      [],
    ];

    mockFetch(() => {
      const page = pages[callCount] ?? [];
      callCount++;
      return Promise.resolve(new Response(JSON.stringify(page)));
    });

    const bars = await fetchAllKlines({
      symbol: "BTCUSDT",
      interval: "1m",
      startTime: 1000,
      endTime: 5000,
    });

    expect(bars).toHaveLength(3);
    expect(callCount).toBe(3);
    const firstBar = requireValue(bars[0], "first paginated bar");
    const thirdBar = requireValue(bars[2], "third paginated bar");
    expect(firstBar.bar_start_ts_ms).toBe(1000);
    expect(thirdBar.bar_start_ts_ms).toBe(3000);
  });
});

// --- Live integration test (run with: bun test -t "live") ---

describe("fetchKlines (live)", () => {
  test.skipIf(!process.env["LIVE_TEST"])(
    "fetches real BTCUSDT 1m klines from Binance",
    async () => {
      const bars = await fetchKlines({
        symbol: "BTCUSDT",
        interval: "1m",
        limit: 5,
      });

      expect(bars.length).toBeGreaterThan(0);
      expect(bars.length).toBeLessThanOrEqual(5);

      const bar = requireValue(bars[0], "first live bar");
      expect(bar.symbol).toBe("BTCUSDT");
      expect(bar.open).toBeGreaterThan(0);
      expect(bar.high).toBeGreaterThanOrEqual(bar.low);
      expect(bar.volume).toBeGreaterThanOrEqual(0);
      expect(bar.bar_start_ts_ms).toBeGreaterThan(0);
      expect(bar.bar_end_ts_ms).toBeGreaterThan(bar.bar_start_ts_ms);
    },
  );
});
