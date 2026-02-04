import { basename, join, resolve } from "node:path";
import { stat } from "node:fs/promises";

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

export interface OnchainWorkspace {
  rootDir: string;
  programDir: string;
  agentId: string;
}

export async function resolveOnchainWorkspace(
  path: string,
): Promise<OnchainWorkspace> {
  const rootDir = resolve(path);
  const rootInfo = await statIfExists(rootDir);
  if (!rootInfo) {
    throw new Error("path does not exist");
  }
  if (!rootInfo.isDirectory()) {
    throw new Error("path must be a directory");
  }

  const programDir = join(rootDir, "program");
  const programInfo = await statIfExists(programDir);
  if (!programInfo || !programInfo.isDirectory()) {
    throw new Error("missing program/ directory");
  }

  const cargoToml = join(programDir, "Cargo.toml");
  const cargoInfo = await statIfExists(cargoToml);
  if (!cargoInfo || !cargoInfo.isFile()) {
    throw new Error("missing program/Cargo.toml");
  }

  return {
    rootDir,
    programDir,
    agentId: basename(rootDir),
  };
}
