import type { OhlcvBar } from "@solclash/simulator";

const BASE_URL = "https://data-api.binance.vision";
const MAX_LIMIT = 1000;

export type BinanceInterval =
  | "1s"
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "6h"
  | "8h"
  | "12h"
  | "1d"
  | "3d"
  | "1w"
  | "1M";

// Raw kline array from Binance API
type RawKline = [
  number, // 0: Open time
  string, // 1: Open price
  string, // 2: High price
  string, // 3: Low price
  string, // 4: Close price
  string, // 5: Volume
  number, // 6: Close time
  string, // 7: Quote asset volume
  number, // 8: Number of trades
  string, // 9: Taker buy base asset volume
  string, // 10: Taker buy quote asset volume
  string, // 11: Unused
];

export interface FetchKlinesOptions {
  symbol: string;
  interval: BinanceInterval;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

function rawKlineToBar(symbol: string, kline: RawKline): OhlcvBar {
  return {
    symbol,
    bar_start_ts_ms: kline[0],
    bar_end_ts_ms: kline[6],
    open: parseFloat(kline[1]),
    high: parseFloat(kline[2]),
    low: parseFloat(kline[3]),
    close: parseFloat(kline[4]),
    volume: parseFloat(kline[5]),
  };
}

/**
 * Fetch a single page of klines from Binance (max 1000).
 */
export async function fetchKlines(
  opts: FetchKlinesOptions,
): Promise<OhlcvBar[]> {
  const params = new URLSearchParams({
    symbol: opts.symbol,
    interval: opts.interval,
    limit: String(Math.min(opts.limit ?? MAX_LIMIT, MAX_LIMIT)),
  });

  if (opts.startTime != null) params.set("startTime", String(opts.startTime));
  if (opts.endTime != null) params.set("endTime", String(opts.endTime));

  const url = `${BASE_URL}/api/v3/klines?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Binance API error ${res.status}: ${body}`);
  }

  const raw = (await res.json()) as RawKline[];
  return raw.map((k) => rawKlineToBar(opts.symbol, k));
}

/**
 * Fetch all klines in a time range, automatically paginating through
 * Binance's 1000-bar-per-request limit.
 */
export async function fetchAllKlines(
  opts: FetchKlinesOptions & { startTime: number; endTime: number },
): Promise<OhlcvBar[]> {
  const bars: OhlcvBar[] = [];
  let cursor = opts.startTime;

  while (cursor < opts.endTime) {
    const page = await fetchKlines({
      symbol: opts.symbol,
      interval: opts.interval,
      startTime: cursor,
      endTime: opts.endTime,
      limit: MAX_LIMIT,
    });

    if (page.length === 0) break;

    bars.push(...page);

    // Advance cursor past the last bar's close time
    const lastBar = page[page.length - 1]!;
    cursor = lastBar.bar_end_ts_ms + 1;
  }

  return bars;
}
