import { describe, expect, test } from "bun:test";
import { deriveRoundMeta, resolveScoringWeightsPath } from "../index.js";
import { join } from "node:path";
import type { RoundMetrics } from "@solclash/simulator";

function makeRoundMetrics(score: number): RoundMetrics {
  return {
    pnl_total: 0,
    drawdown_max: 0,
    exposure_avg: 0,
    score,
    weights: { pnl: 1, drawdown: -0.5, exposure: -0.1 },
    window_metrics: [],
  };
}

describe("resolveScoringWeightsPath", () => {
  test("resolves id to docs/scoring-weights/{id}.json", () => {
    const cwd = process.cwd();
    const path = resolveScoringWeightsPath("v1", cwd);
    expect(path).toBe(join(cwd, "docs", "scoring-weights", "v1.json"));
  });

  test("keeps path references intact", () => {
    const cwd = process.cwd();
    const path = resolveScoringWeightsPath("docs/scoring-weights.json", cwd);
    expect(path).toBe(join(cwd, "docs", "scoring-weights.json"));
  });
});

describe("deriveRoundMeta", () => {
  test("selects winner from mixed positive and negative scores", () => {
    const meta = deriveRoundMeta(
      10,
      20,
      {
        A: makeRoundMetrics(-1),
        B: makeRoundMetrics(3.25),
        C: makeRoundMetrics(1.5),
      },
      {},
    );

    expect(meta.winner).toBe("B");
    expect(meta.scores["A"]).toBe(-1);
    expect(meta.scores["B"]).toBe(3.25);
    expect(meta.scores["C"]).toBe(1.5);
  });

  test("adds missing invalid agents with zero score", () => {
    const meta = deriveRoundMeta(
      10,
      20,
      {
        A: makeRoundMetrics(2),
      },
      { B: "build_failed" },
    );

    expect(meta.scores["A"]).toBe(2);
    expect(meta.scores["B"]).toBe(0);
    expect(meta.invalid_agents["B"]).toBe("build_failed");
  });

  test("does not override existing scores for invalid agent ids", () => {
    const meta = deriveRoundMeta(
      10,
      20,
      {
        A: makeRoundMetrics(2),
      },
      { A: "runtime_failed" },
    );

    expect(meta.scores["A"]).toBe(2);
    expect(meta.invalid_agents["A"]).toBe("runtime_failed");
  });

  test("returns null winner when no scores exist", () => {
    const meta = deriveRoundMeta(10, 20, {}, {});

    expect(meta.winner).toBeNull();
    expect(Object.keys(meta.scores)).toHaveLength(0);
  });
});
