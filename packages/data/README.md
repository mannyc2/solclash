# @solclash/data

OHLCV data loading, validation, and windowing for the SolClash simulator.

## API

### `loadTape(tapeSource, opts) -> Promise<OhlcvBar[]>`

Loads bars using the configured tape source.

- Historical: uses `dataset_id` or `path`
- Synthetic: uses a deterministic generator (`gbm_v1`)

For `dataset_id`, the loader resolves relative to `<baseDir>/data/` and prefers
`.jsonl` when available (fallback to `.json`).

```ts
import { loadTape } from "@solclash/data";

const bars = await loadTape(
  {
    type: "synthetic",
    generator_id: "gbm_v1",
    seed: 42,
    params: { total_bars: 1000 },
  },
  { barIntervalSeconds: 60, symbol: "BTC-PERP" },
);
```

### `loadTapeWithMeta(tapeSource, opts) -> Promise<{ instrument?: InstrumentMeta; bars: OhlcvBar[] }>`

Loads bars plus optional instrument metadata (if present in the data file).
Supports JSON files with `{ instrument, bars }` or raw bar arrays. For JSONL,
supports an optional first-line `{ instrument: {...} }` header.

### `validateBars(bars, barIntervalMs) -> ValidationError[]`

Runs integrity checks on a bar array:

- All prices positive (`open`, `high`, `low`, `close` > 0)
- `volume >= 0`
- `low <= open` and `low <= close`
- `high >= open` and `high >= close`
- Bars are contiguous at the configured interval

Returns an empty array if all bars are valid.

```ts
import { validateBars } from "@solclash/data";

const errors = validateBars(bars, 60_000); // 1-minute bars
```

### `buildWindows(bars, windowDurationBars, maxOverlapPct) -> WindowDef[]`

Slices a bar array into window definitions based on duration and overlap settings.

### `sliceBars(bars, windowDef) -> OhlcvBar[]`

Extracts the bars for a given `WindowDef` from the full bar array.

### `selectWindows(windows, bars, sampling, total) -> WindowDef[]`

Selects a subset of windows using one of two modes configured via `WindowSamplingConfig`:

- **Sequential** — returns the first `total` windows in order.
- **Stratified** — picks high-stress windows first (by volatility), then round-robins across volatility/trend/volume buckets for balanced market-condition coverage. Uses FNV-1a hashing with an optional `seed` for deterministic results.

## Binance Fetcher

### `fetchKlines(opts) -> Promise<OhlcvBar[]>`

Fetches a single page of kline (candlestick) data from the Binance public API. Max 1000 bars per request.

### `fetchAllKlines(opts) -> Promise<OhlcvBar[]>`

Fetches all klines in a time range, automatically paginating through the 1000-bar limit.

```ts
import { fetchAllKlines } from "@solclash/data";

const bars = await fetchAllKlines({
  symbol: "BTCUSDT",
  interval: "1m",
  startTime: Date.now() - 24 * 60 * 60 * 1000,
  endTime: Date.now(),
});
```

Supported intervals: `1s`, `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `8h`, `12h`, `1d`, `3d`, `1w`, `1M`.

Uses the public `https://data-api.binance.vision` endpoint (no API key required).

## Tests

```sh
bun test packages/data/
```
