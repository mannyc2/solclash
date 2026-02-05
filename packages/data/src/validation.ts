import type { OhlcvBar } from "@solclash/simulator";
import type { WindowDef } from "@solclash/simulator";

interface ValidationError {
  index: number;
  field: string;
  message: string;
}

export function validateBars(
  bars: OhlcvBar[],
  barIntervalMs: number,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (!bar) {
      continue;
    }

    // Positive prices
    for (const field of ["open", "high", "low", "close"] as const) {
      if (bar[field] <= 0) {
        errors.push({ index: i, field, message: `${field} must be > 0` });
      }
    }

    // Volume non-negative
    if (bar.volume < 0) {
      errors.push({
        index: i,
        field: "volume",
        message: "volume must be >= 0",
      });
    }

    // low <= open/close <= high
    if (bar.low > bar.open) {
      errors.push({ index: i, field: "low", message: "low must be <= open" });
    }
    if (bar.low > bar.close) {
      errors.push({ index: i, field: "low", message: "low must be <= close" });
    }
    if (bar.high < bar.open) {
      errors.push({ index: i, field: "high", message: "high must be >= open" });
    }
    if (bar.high < bar.close) {
      errors.push({
        index: i,
        field: "high",
        message: "high must be >= close",
      });
    }

    // Contiguity check
    if (i > 0) {
      const prev = bars[i - 1];
      if (!prev) {
        continue;
      }
      const expectedStart = prev.bar_start_ts_ms + barIntervalMs;
      if (bar.bar_start_ts_ms !== expectedStart) {
        errors.push({
          index: i,
          field: "bar_start_ts_ms",
          message: `expected ${expectedStart}, got ${bar.bar_start_ts_ms} (non-contiguous)`,
        });
      }
    }
  }

  return errors;
}

export function collectInvalidBars(
  bars: OhlcvBar[],
  barIntervalMs: number,
): {
  errors: ValidationError[];
  error_map: Map<number, ValidationError[]>;
} {
  const errors = validateBars(bars, barIntervalMs);
  const error_map = new Map<number, ValidationError[]>();
  for (const err of errors) {
    const list = error_map.get(err.index) ?? [];
    list.push(err);
    error_map.set(err.index, list);
  }
  return { errors, error_map };
}

export function getWindowInvalidReason(
  windowDef: WindowDef,
  errors: ValidationError[],
): string | null {
  if (errors.length === 0) return null;
  const inWindow = errors.filter(
    (e) => e.index >= windowDef.start_index && e.index <= windowDef.end_index,
  );
  if (inWindow.length === 0) return null;
  // Keep the reason compact while still indicating multiple failures.
  const first = inWindow[0];
  if (!first) {
    return null;
  }
  return `bar_validation_failed: index=${first.index} field=${first.field} message=${first.message} (count=${inWindow.length})`;
}
