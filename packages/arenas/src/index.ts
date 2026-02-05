import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface ArenaWorkspaceRequirements {
  required_directories: string[];
  required_files: string[];
}

export interface ArenaDefinition {
  arena_id: string;
  starter_path: string;
  build_command: string[];
  artifact_path: string;
  workspace_requirements: ArenaWorkspaceRequirements;
  supported_baselines: string[];
  default_config_path: string;
}

export interface ValidatedWorkspace {
  root_dir: string;
  program_dir: string;
  artifact_path: string;
}

const ARENA_DEFINITIONS: Record<string, ArenaDefinition> = {
  "btc-perp-v1": {
    arena_id: "btc-perp-v1",
    starter_path: "packages/arenas/arenas/btc-perp-v1/starter",
    build_command: ["cargo", "build-sbf"],
    artifact_path: "program/target/deploy/solclash_policy.so",
    workspace_requirements: {
      required_directories: ["program", "program/src"],
      required_files: ["program/Cargo.toml"],
    },
    supported_baselines: ["BUY_AND_HOLD", "FLAT"],
    default_config_path:
      "packages/arenas/arenas/btc-perp-v1/default-config.json",
  },
};

export function getArenaDefinition(arenaId: string): ArenaDefinition {
  const definition = ARENA_DEFINITIONS[arenaId];
  if (!definition) {
    throw new Error(`Unknown arena_id: ${arenaId}`);
  }
  return definition;
}

export function validateSupportedBaselines(
  arenaId: string,
  enabledBaselines: string[],
): void {
  const definition = getArenaDefinition(arenaId);
  const allowed = new Set(definition.supported_baselines);

  for (const baseline of enabledBaselines) {
    if (!allowed.has(baseline)) {
      throw new Error(
        `Unsupported baseline for arena ${arenaId}: ${baseline}. Supported baselines: ${definition.supported_baselines.join(", ")}`,
      );
    }
  }
}

export async function validateWorkspaceForArena(
  arenaId: string,
  workspacePath: string,
): Promise<ValidatedWorkspace> {
  const definition = getArenaDefinition(arenaId);
  const rootDir = resolve(workspacePath);

  const rootInfo = await statIfExists(rootDir);
  if (!rootInfo) {
    throw new Error("path does not exist");
  }
  if (!rootInfo.isDirectory()) {
    throw new Error("path must be a directory");
  }

  for (const dirPath of definition.workspace_requirements
    .required_directories) {
    const resolvedDir = join(rootDir, dirPath);
    const info = await statIfExists(resolvedDir);
    if (!info || !info.isDirectory()) {
      throw new Error(`missing ${dirPath}/ directory`);
    }
  }

  for (const filePath of definition.workspace_requirements.required_files) {
    const resolvedFile = join(rootDir, filePath);
    const info = await statIfExists(resolvedFile);
    if (!info || !info.isFile()) {
      throw new Error(`missing ${filePath}`);
    }
  }

  return {
    root_dir: rootDir,
    program_dir: join(rootDir, "program"),
    artifact_path: join(rootDir, definition.artifact_path),
  };
}

async function statIfExists(path: string) {
  try {
    return await stat(path);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: string }).code
        : null;
    if (code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export {
  loadArenaContext,
  resolveScoringWeightsPath,
  TournamentConfigSchema,
  TournamentEditConfigSchema,
  type ArenaContext,
  type TournamentConfig,
} from "./loader.js";
export {
  executeRound,
  deriveRoundMeta,
  type RunResult,
} from "./runtime/runner.js";
export {
  closeLogSinks,
  writeRoundMeta,
  writeRoundResults,
  writeSummary,
  writeWindowLogs,
  type RoundMeta,
} from "./runtime/logger.js";
export { HarnessClient, type HarnessProgram } from "./runtime/harness.js";
export {
  buildPolicies,
  prepareProgramsAndInvalidAgents,
  shouldBuildOnchain,
  type OnchainWorkspaceAgent,
} from "./runtime/onchain.js";
