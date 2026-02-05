import { BUY_AND_HOLD, FLAT, type PolicyFn } from "@solclash/simulator";
import {
  validateWorkspaceForArena,
  type ValidatedWorkspace,
} from "@solclash/arenas";
import {
  loadAgentManifests,
  validateAgentManifestsForArena,
  type AgentManifestResolved,
} from "./index.js";

const BUILTINS: Record<string, PolicyFn> = { BUY_AND_HOLD, FLAT };

export interface Agent {
  id: string;
  policy: PolicyFn;
}

export function getBuiltinAgent(name: string): Agent | null {
  const policy = BUILTINS[name];
  return policy ? { id: name, policy } : null;
}

// Resolves baseline names to Agent objects. Unknown baselines are returned
// in invalidAgents rather than throwing, so the caller can report them.
export function resolveBaselines(baselineNames: string[]): {
  agents: Agent[];
  invalidAgents: Record<string, string>;
} {
  const agents: Agent[] = [];
  const invalidAgents: Record<string, string> = {};

  for (const name of baselineNames) {
    const agent = getBuiltinAgent(name);
    if (!agent) {
      invalidAgents[name] = "unknown_baseline";
      continue;
    }
    agents.push(agent);
  }

  return { agents, invalidAgents };
}

export interface ResolvedAgents {
  manifests: AgentManifestResolved[];
  builtinAgents: Agent[];
  invalidBaselines: Record<string, string>;
  validatedWorkspaces: Map<string, ValidatedWorkspace>;
}

export async function resolveAllAgents(opts: {
  manifestPaths: string[];
  arenaId: string;
  baselineNames: string[];
}): Promise<ResolvedAgents> {
  const manifests = await loadAgentManifests(opts.manifestPaths);
  validateAgentManifestsForArena(manifests, opts.arenaId);

  // Check for baseline ID collisions
  const baselineIds = new Set(opts.baselineNames);
  for (const manifest of manifests) {
    if (baselineIds.has(manifest.id)) {
      throw new Error(
        `Agent id collides with builtin baseline: ${manifest.id}`,
      );
    }
  }

  // Validate workspaces
  const validatedWorkspaces = new Map<string, ValidatedWorkspace>();
  for (const manifest of manifests) {
    try {
      const workspace = await validateWorkspaceForArena(
        opts.arenaId,
        manifest.workspace_path,
      );
      validatedWorkspaces.set(manifest.id, workspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid workspace";
      throw new Error(
        `Invalid workspace for agent '${manifest.id}' at ${manifest.workspace_path}: ${message}`,
      );
    }
  }

  // Resolve builtin agents
  const { agents: builtinAgents, invalidAgents: invalidBaselines } =
    resolveBaselines(opts.baselineNames);

  return { manifests, builtinAgents, invalidBaselines, validatedWorkspaces };
}
