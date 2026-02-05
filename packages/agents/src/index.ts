import { dirname, resolve } from "node:path";
import { z } from "zod";

export const AGENT_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "glm",
  "kimi",
] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const AgentManifestSchema = z
  .object({
    id: z.string().min(1),
    arena_id: z.string().min(1),
    provider: z.enum(AGENT_PROVIDERS),
    workspace: z.string().min(1),
    model: z.string().optional(),
  })
  .strict();

export type AgentManifest = z.infer<typeof AgentManifestSchema>;

export interface AgentManifestResolved extends AgentManifest {
  manifest_path: string;
  workspace_path: string;
}

export async function loadAgentManifest(
  manifestPath: string,
): Promise<AgentManifestResolved> {
  const resolvedManifestPath = resolve(manifestPath);

  let raw: unknown;
  try {
    raw = await Bun.file(resolvedManifestPath).json();
  } catch (err) {
    const reason = err instanceof Error ? err.message : "invalid_json";
    throw new Error(
      `Invalid agent manifest at ${resolvedManifestPath}: ${reason}`,
    );
  }

  const parsed = AgentManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid agent manifest at ${resolvedManifestPath}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const data = parsed.data;
  const baseDir = dirname(resolvedManifestPath);

  return {
    ...data,
    manifest_path: resolvedManifestPath,
    workspace_path: resolve(baseDir, data.workspace),
  };
}

export async function loadAgentManifests(
  manifestPaths: string[],
): Promise<AgentManifestResolved[]> {
  const manifests: AgentManifestResolved[] = [];
  for (const manifestPath of manifestPaths) {
    manifests.push(await loadAgentManifest(manifestPath));
  }
  return manifests;
}

export function validateAgentManifestsForArena(
  manifests: AgentManifestResolved[],
  arenaId: string,
): void {
  const ids = new Set<string>();

  for (const manifest of manifests) {
    if (manifest.arena_id !== arenaId) {
      throw new Error(
        `Agent manifest ${manifest.manifest_path} targets arena_id=${manifest.arena_id}, expected ${arenaId}`,
      );
    }

    if (ids.has(manifest.id)) {
      throw new Error(`Duplicate agent id in manifests: ${manifest.id}`);
    }
    ids.add(manifest.id);
  }
}

export {
  resolveBaselines,
  resolveAllAgents,
  getBuiltinAgent,
  type Agent,
  type ResolvedAgents,
} from "./resolve.js";
