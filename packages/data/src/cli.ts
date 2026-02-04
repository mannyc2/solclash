#!/usr/bin/env bun
import { parseArgs } from "util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TapeSource } from "@solclash/simulator";
import { loadTape } from "./tape.js";
import { fetchAllKlines, type BinanceInterval } from "./binance.js";

const subcommand = process.argv[2];

if (subcommand === "generate") {
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      out: { type: "string", default: "tmp/bars.json" },
      count: { type: "string", default: "4000" },
      interval: { type: "string", default: "60" },
      symbol: { type: "string", default: "BTC-PERP" },
      seed: { type: "string", default: "42" },
      "start-price": { type: "string", default: "50000" },
      "drift-bps": { type: "string", default: "0" },
      "vol-bps": { type: "string", default: "50" },
    },
    strict: true,
    allowPositionals: false,
  });

  const count = Number(values.count);
  const interval = Number(values.interval);
  const seed = Number(values.seed);
  const startPrice = Number(values["start-price"]);
  const driftBps = Number(values["drift-bps"]);
  const volBps = Number(values["vol-bps"]);

  const source: TapeSource = {
    type: "synthetic",
    generator_id: "gbm_v1",
    seed,
    params: {
      total_bars: count,
      start_price: startPrice,
      drift_bps_per_bar: driftBps,
      vol_bps_per_sqrt_bar: volBps,
    },
  };

  const bars = await loadTape(source, {
    barIntervalSeconds: interval,
    symbol: values.symbol,
  });

  const outPath = values.out;
  mkdirSync(dirname(outPath), { recursive: true });

  if (outPath.endsWith(".jsonl")) {
    writeFileSync(
      outPath,
      bars.map((b) => JSON.stringify(b)).join("\n") + "\n",
    );
  } else {
    writeFileSync(outPath, JSON.stringify(bars, null, 2));
  }

  console.log(`Wrote ${bars.length} bars to ${outPath}`);
} else if (subcommand === "fetch") {
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      out: { type: "string" },
      symbol: { type: "string" },
      interval: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (
    !values.out ||
    !values.symbol ||
    !values.interval ||
    !values.start ||
    !values.end
  ) {
    console.error(
      "Usage: solclash-data fetch --out <path> --symbol <s> --interval <s> --start <ms|ISO> --end <ms|ISO>",
    );
    process.exit(1);
  }

  const parseTime = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : new Date(v).getTime();
  };

  const bars = await fetchAllKlines({
    symbol: values.symbol,
    interval: values.interval as BinanceInterval,
    startTime: parseTime(values.start),
    endTime: parseTime(values.end),
  });

  const outPath = values.out;
  mkdirSync(dirname(outPath), { recursive: true });

  if (outPath.endsWith(".jsonl")) {
    writeFileSync(
      outPath,
      bars.map((b) => JSON.stringify(b)).join("\n") + "\n",
    );
  } else {
    writeFileSync(outPath, JSON.stringify(bars, null, 2));
  }

  console.log(`Wrote ${bars.length} bars to ${outPath}`);
} else {
  console.error(
    "Usage:\n  solclash-data generate [options]    Generate synthetic bars (GBM)\n  solclash-data fetch [options]       Fetch historical bars from Binance",
  );
  process.exit(1);
}
