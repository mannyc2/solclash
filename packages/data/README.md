# @solclash/data

OHLCV data loading, validation, and windowing for the SolClash simulator.

## API

### `loadBarsFromJson(filePath) -> Promise<OhlcvBar[]>`

Loads bars from a JSON file containing an array of `OhlcvBar` objects.

### `loadBarsFromJsonl(filePath) -> Promise<OhlcvBar[]>`

Loads bars from a JSONL file (one JSON object per line).

### `loadTape(tapeSource, opts) -> Promise<OhlcvBar[]>`

Loads bars using the configured tape source.

- Historical: uses `dataset_id` or `path`
- Synthetic: uses a deterministic generator (`gbm_v1`)

```ts
import { loadTape } from "@solclash/data";

const bars = await loadTape(
  { type: "synthetic", generator_id: "gbm_v1", seed: 42, params: { total_bars: 1000 } },
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
if (errors.length > 0) {
  for (const e of errors) {
    console.error(`Bar ${e.index}: ${e.field} — ${e.message}`);
  }
}
```

### `buildWindows(bars, windowDurationBars, maxOverlapPct) -> WindowDef[]`

Slices a bar array into window definitions based on duration and overlap settings.

- `maxOverlapPct = 0` produces non-overlapping windows
- `maxOverlapPct = 50` produces windows with 50% overlap

### `sliceBars(bars, windowDef) -> OhlcvBar[]`

Extracts the bars for a given `WindowDef` from the full bar array.

```ts
import { buildWindows, sliceBars } from "@solclash/data";

const windows = buildWindows(bars, 720, 0);
const firstWindowBars = sliceBars(bars, windows[0]);
```

## Binance Fetcher

### `fetchKlines(opts) -> Promise<OhlcvBar[]>`

Fetches a single page of kline (candlestick) data from the Binance public API. Max 1000 bars per request.

```ts
import { fetchKlines } from "@solclash/data";

const bars = await fetchKlines({
  symbol: "BTCUSDT",
  interval: "1m",
  limit: 500,
});
```

### `fetchAllKlines(opts) -> Promise<OhlcvBar[]>`

Fetches all klines in a time range, automatically paginating through the 1000-bar limit.

```ts
import { fetchAllKlines } from "@solclash/data";

const bars = await fetchAllKlines({
  symbol: "BTCUSDT",
  interval: "1m",
  startTime: Date.now() - 24 * 60 * 60 * 1000, // 24h ago
  endTime: Date.now(),
});
```

Supported intervals: `1s`, `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `8h`, `12h`, `1d`, `3d`, `1w`, `1M`.

Uses the public `https://data-api.binance.vision` endpoint (no API key required).

## Tests

```sh
bun test packages/data/
```
