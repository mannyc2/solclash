import type { OhlcvBar, InstrumentMeta } from "@solclash/simulator";

export interface TapeWithMeta {
  instrument?: InstrumentMeta;
  bars: OhlcvBar[];
}

export async function loadBarsFromJson(filePath: string): Promise<OhlcvBar[]> {
  const data: unknown = await Bun.file(filePath).json();
  const tape = parseJsonTapeData(data, filePath);
  return tape.bars;
}

export async function loadBarsFromJsonl(filePath: string): Promise<OhlcvBar[]> {
  const tape = await loadTapeFromJsonl(filePath);
  return tape.bars;
}

export async function loadTapeFromJson(filePath: string): Promise<TapeWithMeta> {
  const data: unknown = await Bun.file(filePath).json();
  // Support both legacy arrays and the newer { instrument, bars } format.
  return parseJsonTapeData(data, filePath);
}

export async function loadTapeFromJsonl(
  filePath: string,
): Promise<TapeWithMeta> {
  const text = await Bun.file(filePath).text();
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { bars: [] };
  }

  const first = JSON.parse(lines[0]!) as any;
  if (first && typeof first === "object" && "instrument" in first) {
    if (Array.isArray(first.bars)) {
      return parseJsonTapeData(first, filePath);
    }
    // JSONL can start with a metadata header, keeping bar lines unchanged.
    const instrument = first.instrument as InstrumentMeta;
    const bars = lines
      .slice(1)
      .map((line) => JSON.parse(line) as OhlcvBar);
    return { instrument, bars };
  }

  const bars = lines.map((line) => JSON.parse(line) as OhlcvBar);
  return { bars };
}

function parseJsonTapeData(data: unknown, filePath: string): TapeWithMeta {
  if (Array.isArray(data)) {
    return { bars: data as OhlcvBar[] };
  }

  if (data && typeof data === "object") {
    const obj = data as { instrument?: InstrumentMeta; bars?: OhlcvBar[] };
    if (Array.isArray(obj.bars)) {
      return { instrument: obj.instrument, bars: obj.bars };
    }
  }

  throw new Error(`Expected array of bars or {instrument, bars} in ${filePath}`);
}
