import { resolve } from "node:path";

export function resolveScoringWeightsPath(
  refValue: string,
  cwd: string,
): string {
  // Treat bare names as preset ids; treat explicit paths as-is.
  const isPath = refValue.includes("/") || refValue.endsWith(".json");
  return isPath
    ? resolve(cwd, refValue)
    : resolve(cwd, "docs", "scoring-weights", `${refValue}.json`);
}
