import { describe, expect, test } from "bun:test";
import { resolveScoringWeightsPath } from "../weights.js";
import { join } from "node:path";

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
