import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, resolve, sep } from "node:path";
import type { ResolvedPrompt } from "./types.js";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isExplicitPath(ref: string): boolean {
  return (
    ref.includes(sep) ||
    ref.includes("/") ||
    ref.endsWith(".md") ||
    ref.endsWith(".txt")
  );
}

function buildDefaultPrompt(round: number, agentId: string): string {
  if (round === 1) {
    return `You are participating in round 1 of a SolClash tournament (edit phase).

This is your first round — you are working with the starter codebase.
No previous competition results exist yet.

Your agent ID is ${agentId}. It is also available via the SOLCLASH_AGENT_ID environment variable.

<instructions>
1. Read the docs in docs/ to understand the system and policy ABI.
2. Read the existing codebase to understand the current strategy.
3. Make focused, testable improvements to the trading policy.
4. Run \`cargo build-sbf\` in program/ to verify your changes compile.
</instructions>

Keep changes small and deterministic. Prefer measurable improvements over speculative rewrites.`;
  }

  const prev = round - 1;
  return `You are participating in round ${round} of a SolClash tournament (edit phase).

Your agent ID is ${agentId}. It is also available via the SOLCLASH_AGENT_ID environment variable.

Previous competition results are available at logs/rounds/ in your workspace.

<previous-results>
Read these files to understand how you performed:
- logs/rounds/${prev}/round_meta.json — winner, scores, invalid agents
- logs/rounds/${prev}/round_results.json — detailed metrics per agent (PnL, drawdown, exposure)
- logs/rounds/${prev}/summary.json — per-window performance breakdown
- logs/rounds/${prev}/${agentId}/trade_log.jsonl — your trade history
- logs/rounds/${prev}/${agentId}/equity_log.jsonl — your equity curve
- logs/rounds/${prev}/${agentId}/liquidation_log.jsonl — liquidation events
</previous-results>

<instructions>
1. Read your previous round results and identify what went wrong or could improve.
2. Compare your score to the winner's score in round_meta.json.
3. Make targeted changes to your trading policy based on the data.
4. Run \`cargo build-sbf\` in program/ to verify your changes compile.
</instructions>

Focus on fixing concrete issues found in the logs. Prefer data-driven changes over speculative rewrites.`;
}

export function resolveEditPrompt(
  ref: string,
  round: number,
  agentId: string,
): ResolvedPrompt {
  if (ref === "default") {
    const content = buildDefaultPrompt(round, agentId);
    return {
      ref,
      path: null,
      content,
      sha256: sha256(content),
    };
  }

  if (!isExplicitPath(ref)) {
    throw new Error(
      `Unknown built-in prompt '${ref}'. Use "default" or provide a file path.`,
    );
  }

  const resolvedPath = isAbsolute(ref) ? ref : resolve(ref);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Edit prompt not found at ${resolvedPath}`);
  }

  const content = readFileSync(resolvedPath, "utf8");
  return {
    ref,
    path: resolvedPath,
    content,
    sha256: sha256(content),
  };
}
