import { $ } from "bun";
import type { Agent } from "@solclash/agents";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ValidatedWorkspace } from "../index.js";
import type { HarnessClient, HarnessProgram } from "./harness.js";

export interface OnchainWorkspaceAgent {
  id: string;
  workspace: ValidatedWorkspace;
}

async function statIfExists(path: string) {
  try {
    return await stat(path);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: string }).code
        : null;
    if (code === "ENOENT") return null;
    throw err;
  }
}

async function newestMtimeInDir(dir: string): Promise<number> {
  const dirStat = await stat(dir);
  let newest = dirStat.mtimeMs;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const subNewest = await newestMtimeInDir(entryPath);
      if (subNewest > newest) newest = subNewest;
      continue;
    }
    const entryStat = await stat(entryPath);
    if (entryStat.mtimeMs > newest) newest = entryStat.mtimeMs;
  }
  return newest;
}

export async function shouldBuildOnchain(programDir: string): Promise<boolean> {
  try {
    const soPath = join(programDir, "target", "deploy", "solclash_policy.so");
    const soStat = await statIfExists(soPath);
    if (!soStat) return true;

    let newestSource = 0;
    const recordSource = async (path: string) => {
      const info = await statIfExists(path);
      if (!info) return;
      if (info.mtimeMs > newestSource) newestSource = info.mtimeMs;
    };

    await recordSource(join(programDir, "Cargo.toml"));
    await recordSource(join(programDir, "Cargo.lock"));
    await recordSource(join(programDir, "Anchor.toml"));

    const srcDir = join(programDir, "src");
    const srcStat = await statIfExists(srcDir);
    if (!srcStat) return true;
    const srcNewest = await newestMtimeInDir(srcDir);
    if (srcNewest > newestSource) newestSource = srcNewest;

    return newestSource > soStat.mtimeMs;
  } catch {
    return true;
  }
}

export async function prepareProgramsAndInvalidAgents(
  onchainAgents: OnchainWorkspaceAgent[],
): Promise<{
  programs: HarnessProgram[];
  invalidAgents: Record<string, string>;
}> {
  const programs: HarnessProgram[] = [];
  const invalidAgents: Record<string, string> = {};

  for (const agent of onchainAgents) {
    const { program_dir, artifact_path } = agent.workspace;
    try {
      if (await shouldBuildOnchain(program_dir)) {
        await $`cargo build-sbf`.cwd(program_dir);
      } else {
        console.log(`Skipping build for ${agent.id}: artifact is fresh`);
      }
    } catch {
      invalidAgents[agent.id] = "build_failed";
      continue;
    }

    if (!(await Bun.file(artifact_path).exists())) {
      invalidAgents[agent.id] = "missing_artifact";
      continue;
    }
    programs.push({ id: agent.id, so_path: artifact_path });
  }

  return { programs, invalidAgents };
}

export function buildPolicies(
  programs: HarnessProgram[],
  harness: HarnessClient,
): Agent[] {
  return programs.map((program) => ({
    id: program.id,
    policy: async (input) => harness.eval(program.id, input),
  }));
}
