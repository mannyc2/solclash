#!/usr/bin/env bun
// TODO: Move this CLI to its own app (e.g. apps/data-cli). Executables shouldn't
// live in library packages — @solclash/data should only export library code.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import type { TapeSource } from "@solclash/simulator";
import { fetchAllKlines, type BinanceInterval } from "./binance.js";
import { loadTape } from "./tape.js";

async function runGenerate(): Promise<void> {
  const parsed = parseArgs({
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
  const values = parsed.values as {
    out: string;
    count: string;
    interval: string;
    symbol: string;
    seed: string;
    "start-price": string;
    "drift-bps": string;
    "vol-bps": string;
  };

  const source: TapeSource = {
    type: "synthetic",
    generator_id: "gbm_v1",
    seed: Number(values.seed),
    params: {
      total_bars: Number(values.count),
      start_price: Number(values["start-price"]),
      drift_bps_per_bar: Number(values["drift-bps"]),
      vol_bps_per_sqrt_bar: Number(values["vol-bps"]),
    },
  };

  const bars = await loadTape(source, {
    barIntervalSeconds: Number(values.interval),
    symbol: values.symbol,
  });

  const outPath = values.out;
  mkdirSync(dirname(outPath), { recursive: true });
  if (outPath.endsWith(".jsonl")) {
    writeFileSync(
      outPath,
      bars.map((bar) => JSON.stringify(bar)).join("\n") + "\n",
    );
  } else {
    writeFileSync(outPath, JSON.stringify(bars, null, 2));
  }

  console.log(`Wrote ${bars.length} bars to ${outPath}`);
}

async function runFetch(): Promise<void> {
  const parsed = parseArgs({
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
  const values = parsed.values as {
    out?: string;
    symbol?: string;
    interval?: string;
    start?: string;
    end?: string;
  };

  if (
    !values.out ||
    !values.symbol ||
    !values.interval ||
    !values.start ||
    !values.end
  ) {
    throw new Error(
      "Usage: solclash-data fetch --out <path> --symbol <s> --interval <s> --start <ms|ISO> --end <ms|ISO>",
    );
  }

  const parseTime = (value: string): number => {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : new Date(value).getTime();
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
      bars.map((bar) => JSON.stringify(bar)).join("\n") + "\n",
    );
  } else {
    writeFileSync(outPath, JSON.stringify(bars, null, 2));
  }

  console.log(`Wrote ${bars.length} bars to ${outPath}`);
}

async function main(): Promise<void> {
  const subcommand = process.argv[2];
  if (subcommand === "generate") {
    await runGenerate();
    return;
  }
  if (subcommand === "fetch") {
    await runFetch();
    return;
  }

  throw new Error(
    "Usage:\n  solclash-data generate [options]    Generate synthetic bars (GBM)\n  solclash-data fetch [options]       Fetch historical bars from Binance",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
