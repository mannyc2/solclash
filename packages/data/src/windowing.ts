import type { OhlcvBar, WindowDef } from "@solclash/simulator";

export function buildWindows(
  bars: OhlcvBar[],
  windowDurationBars: number,
  maxOverlapPct: number,
): WindowDef[] {
  if (bars.length < windowDurationBars) return [];

  const step = Math.max(
    1,
    Math.floor(windowDurationBars * (1 - maxOverlapPct / 100)),
  );

  const windows: WindowDef[] = [];
  let startIdx = 0;
  let windowNum = 0;

  while (startIdx + windowDurationBars <= bars.length) {
    const endIdx = startIdx + windowDurationBars - 1;
    windows.push({
      window_id: `w${windowNum}`,
      start_index: startIdx,
      end_index: endIdx,
    });
    windowNum++;
    startIdx += step;
  }

  return windows;
}

export function sliceBars(
  bars: OhlcvBar[],
  windowDef: WindowDef,
): OhlcvBar[] {
  return bars.slice(windowDef.start_index, windowDef.end_index + 1);
}
