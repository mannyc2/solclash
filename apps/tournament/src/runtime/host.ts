/** ContainerRuntime backed by temp directories on the host. Used in tests. */
import { mkdir, rm, mkdtemp, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  runCommand,
  type ContainerHandle,
  type ContainerRuntime,
  type CreateContainerOptions,
  type ExecOptions,
  type ExecResult,
} from "./container.js";

function mergeEnv(
  overrides?: Record<string, string>,
): Record<string, string> | undefined {
  if (!overrides || Object.keys(overrides).length === 0) {
    return undefined;
  }
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      base[key] = value;
    }
  }
  return { ...base, ...overrides };
}

function resolveContainerPath(root: string, path: string): string {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return join(root, normalized);
}

export class HostRuntime implements ContainerRuntime {
  kind: "host" = "host";

  async create(_options: CreateContainerOptions): Promise<ContainerHandle> {
    const root = await mkdtemp(join(tmpdir(), "solclash-host-"));
    return { id: root };
  }

  async exec(
    container: ContainerHandle,
    command: string[],
    options?: ExecOptions,
  ): Promise<ExecResult> {
    const cwd = options?.cwd
      ? resolveContainerPath(container.id, options.cwd)
      : container.id;
    const env = mergeEnv(options?.env);
    return runCommand(command, { cwd, env });
  }

  async copyTo(
    container: ContainerHandle,
    srcPath: string,
    destPath: string,
  ): Promise<void> {
    const dest = resolveContainerPath(container.id, destPath);
    await copyPath(srcPath, dest);
  }

  async copyFrom(
    container: ContainerHandle,
    srcPath: string,
    destPath: string,
  ): Promise<void> {
    const src = resolveContainerPath(container.id, srcPath);
    await copyPath(src, destPath);
  }

  async remove(container: ContainerHandle): Promise<void> {
    await rm(container.id, { recursive: true, force: true });
  }
}

async function copyPath(src: string, dest: string): Promise<void> {
  const srcStat = await stat(src);
  if (srcStat.isFile()) {
    if (dest.endsWith("/")) {
      await mkdir(dest, { recursive: true });
      const result = await runCommand(["cp", src, join(dest, basename(src))]);
      if (result.code !== 0) {
        throw new Error(`host copy failed: ${result.stderr}`);
      }
      return;
    }
    await mkdir(dirname(dest), { recursive: true });
    const result = await runCommand(["cp", src, dest]);
    if (result.code !== 0) {
      throw new Error(`host copy failed: ${result.stderr}`);
    }
    return;
  }

  await mkdir(dest, { recursive: true });
  const result = await runCommand(["cp", "-R", `${src}/.`, dest]);
  if (result.code !== 0) {
    throw new Error(`host copy failed: ${result.stderr}`);
  }
}
