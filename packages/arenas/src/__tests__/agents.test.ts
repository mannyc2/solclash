import { describe, expect, test } from "bun:test";
import { resolveBaselines } from "../index.js";

describe("resolveBaselines", () => {
  test("resolves known baselines for btc-perp-v1", () => {
    const result = resolveBaselines("btc-perp-v1", ["BUY_AND_HOLD", "FLAT"]);
    expect(result.agents.map((a) => a.id)).toEqual(["BUY_AND_HOLD", "FLAT"]);
    expect(Object.keys(result.invalidAgents)).toHaveLength(0);
  });

  test("collects unknown baselines without throwing", () => {
    const result = resolveBaselines("btc-perp-v1", [
      "BUY_AND_HOLD",
      "UNKNOWN_BASELINE",
    ]);
    expect(result.agents.map((a) => a.id)).toEqual(["BUY_AND_HOLD"]);
    expect(result.invalidAgents["UNKNOWN_BASELINE"]).toBe("unknown_baseline");
  });
});
