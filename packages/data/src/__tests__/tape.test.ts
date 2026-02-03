import { describe, test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTape } from "../tape.js";

describe("loadTape", () => {
  test("loads historical tape from JSON and JSONL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "solclash-data-"));
    const jsonPath = join(dir, "bars.json");
    const jsonlPath = join(dir, "bars.jsonl");

    const bars = [
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

    await writeFile(jsonPath, JSON.stringify(bars));
    await writeFile(jsonlPath, bars.map((b) => JSON.stringify(b)).join("\n"));

    const fromJson = await loadTape(
      { type: "historical", path: jsonPath },
      { barIntervalSeconds: 60 },
    );
    const fromJsonl = await loadTape(
      { type: "historical", path: jsonlPath },
      { barIntervalSeconds: 60 },
    );

    expect(fromJson).toHaveLength(1);
    expect(fromJsonl).toHaveLength(1);
  });

  test("resolves dataset_id under baseDir/data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "solclash-data-"));
    const dataDir = join(dir, "data");
    await mkdir(dataDir);
    const datasetPath = join(dataDir, "sample.jsonl");
    const bar = {
      symbol: "BTC-PERP",
      bar_start_ts_ms: 0,
      bar_end_ts_ms: 60000,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
    };
    await writeFile(datasetPath, JSON.stringify(bar) + "\n");

    const bars = await loadTape(
      { type: "historical", dataset_id: "sample" },
      { baseDir: dir, barIntervalSeconds: 60 },
    );
    expect(bars).toHaveLength(1);
  });

  test("synthetic tape is deterministic for same seed/params", async () => {
    const tapeSource = {
      type: "synthetic" as const,
      generator_id: "gbm_v1",
      seed: 123,
      params: { total_bars: 5 },
    };
    const a = await loadTape(tapeSource, {
      barIntervalSeconds: 60,
      symbol: "BTC-PERP",
    });
    const b = await loadTape(tapeSource, {
      barIntervalSeconds: 60,
      symbol: "BTC-PERP",
    });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
