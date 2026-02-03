import { $, type FileSink } from "bun";
import type { WindowAgentResult } from "@solclash/simulator";
import type { WindowSummary, RoundMetrics } from "@solclash/simulator";
import { join } from "node:path";

function toJsonl(entries: unknown[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

const LOG_HWM = 1024 * 1024; // 1MB buffer before auto-flush
const sinks = new Map<string, FileSink>();

function getSink(path: string): FileSink {
  const existing = sinks.get(path);
  if (existing) return existing;
  const sink = Bun.file(path).writer({ highWaterMark: LOG_HWM });
  sinks.set(path, sink);
  return sink;
}

function appendJsonl(path: string, entries: unknown[]): void {
  if (entries.length === 0) return;
  const sink = getSink(path);
  sink.write(toJsonl(entries));
}

export async function closeLogSinks(): Promise<void> {
  const closers = Array.from(sinks.values()).map((sink) =>
    Promise.resolve(sink.end()),
  );
  await Promise.allSettled(closers);
  sinks.clear();
}

export async function writeWindowLogs(
  outputDir: string,
  agentId: string,
  result: WindowAgentResult,
): Promise<void> {
  const dir = join(outputDir, agentId);
  await $`mkdir -p ${dir}`.quiet();

  if (result.policy_log.length > 0) {
    appendJsonl(join(dir, "policy_log.jsonl"), result.policy_log);
  }
  if (result.trade_log.length > 0) {
    appendJsonl(join(dir, "trade_log.jsonl"), result.trade_log);
  }
  if (result.equity_log.length > 0) {
    appendJsonl(join(dir, "equity_log.jsonl"), result.equity_log);
  }
  if (result.liquidation_log.length > 0) {
    appendJsonl(join(dir, "liquidation_log.jsonl"), result.liquidation_log);
  }
}

export async function writeSummary(
  outputDir: string,
  summaries: WindowSummary[],
): Promise<void> {
  await $`mkdir -p ${outputDir}`.quiet();
  await Bun.write(
    join(outputDir, "summary.json"),
    JSON.stringify(summaries, null, 2),
  );
}

export async function writeRoundResults(
  outputDir: string,
  results: Record<string, RoundMetrics>,
): Promise<void> {
  await $`mkdir -p ${outputDir}`.quiet();
  await Bun.write(
    join(outputDir, "round_results.json"),
    JSON.stringify(results, null, 2),
  );
}

export interface RoundMeta {
  round_start_ts: number;
  round_end_ts: number;
  winner: string | null;
  scores: Record<string, number>;
  invalid_agents: Record<string, string>;
}

export async function writeRoundMeta(
  outputDir: string,
  meta: RoundMeta,
): Promise<void> {
  // round_meta.json is the canonical artifact for winner, invalids, and timestamps.
  await $`mkdir -p ${outputDir}`.quiet();
  await Bun.write(
    join(outputDir, "round_meta.json"),
    JSON.stringify(meta, null, 2),
  );
}
