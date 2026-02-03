import type { PolicyFn } from "@solclash/simulator";
import { BUY_AND_HOLD, FLAT } from "@solclash/simulator";
import { basename } from "node:path";

const BUILTINS: Record<string, PolicyFn> = {
  BUY_AND_HOLD,
  FLAT,
};

export interface Agent {
  id: string;
  policy: PolicyFn;
}

export function getBuiltinAgent(name: string): Agent | null {
  const policy = BUILTINS[name];
  if (!policy) return null;
  return { id: name, policy };
}

export async function loadAgentModule(path: string): Promise<Agent> {
  const mod = await import(path);
  const policy = mod.default ?? mod.policy;
  if (typeof policy !== "function") {
    throw new Error(`Agent module at ${path} must export a PolicyFn as default or named 'policy'`);
  }
  const id = basename(path).replace(/\.[cm]?[jt]sx?$/, "");
  return { id, policy: policy as PolicyFn };
}

export async function resolveAgents(
  baselineNames: string[],
  agentPaths: string[],
): Promise<Agent[]> {
  const { agents, invalidAgents } = await resolveAgentsWithErrors(
    baselineNames,
    agentPaths,
  );
  if (Object.keys(invalidAgents).length > 0) {
    const reasons = Object.entries(invalidAgents)
      .map(([id, reason]) => `${id}: ${reason}`)
      .join(", ");
    throw new Error(`Invalid agents: ${reasons}`);
  }
  return agents;
}

export async function resolveAgentsWithErrors(
  baselineNames: string[],
  agentPaths: string[],
): Promise<{ agents: Agent[]; invalidAgents: Record<string, string> }> {
  const agents: Agent[] = [];
  const invalidAgents: Record<string, string> = {};

  // Continue the run even if some agents fail to load; mark them invalid.
  for (const name of baselineNames) {
    const agent = getBuiltinAgent(name);
    if (!agent) {
      invalidAgents[name] = "unknown_baseline";
      continue;
    }
    agents.push(agent);
  }

  for (const p of agentPaths) {
    try {
      const agent = await loadAgentModule(p);
      agents.push(agent);
    } catch (err) {
      // Record the failure reason and continue so the round can finish.
      const reason =
        err instanceof Error ? err.message : "invalid_agent_module";
      invalidAgents[p] = reason;
    }
  }

  return { agents, invalidAgents };
}
