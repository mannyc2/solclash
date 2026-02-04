import { spawn } from "bun";
import type {
  ContainerHandle,
  ContainerRuntime,
  CreateContainerOptions,
  ExecOptions,
  ExecResult,
} from "./container.js";

async function runCommand(
  command: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<ExecResult> {
  const proc = spawn(command, {
    cwd: options?.cwd,
    env: options?.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stdout, stderr };
}

export class DockerRuntime implements ContainerRuntime {
  kind: "docker" = "docker";

  async create(options: CreateContainerOptions): Promise<ContainerHandle> {
    const args = ["docker", "create"];
    if (options.name) {
      args.push("--name", options.name);
    }
    if (options.workdir) {
      args.push("-w", options.workdir);
    }
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push("-e", `${key}=${value}`);
      }
    }
    args.push(options.image, "sleep", "infinity");

    const createResult = await runCommand(args);
    if (createResult.code !== 0) {
      console.error(`\nDocker create failed:`);
      console.error(createResult.stderr);
      throw new Error(`docker create failed: ${createResult.stderr}`);
    }
    const id = createResult.stdout.trim();
    const startResult = await runCommand(["docker", "start", id]);
    if (startResult.code !== 0) {
      console.error(`\nDocker start failed:`);
      console.error(startResult.stderr);
      throw new Error(`docker start failed: ${startResult.stderr}`);
    }
    return { id, workdir: options.workdir };
  }

  async exec(
    container: ContainerHandle,
    command: string[],
    options?: ExecOptions,
  ): Promise<ExecResult> {
    const args = ["docker", "exec"];
    if (options?.cwd) {
      args.push("-w", options.cwd);
    }
    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push("-e", `${key}=${value}`);
      }
    }
    args.push(container.id, ...command);
    return runCommand(args);
  }

  async copyTo(
    container: ContainerHandle,
    srcPath: string,
    destPath: string,
  ): Promise<void> {
    const result = await runCommand([
      "docker",
      "cp",
      srcPath,
      `${container.id}:${destPath}`,
    ]);
    if (result.code !== 0) {
      console.error(`\nDocker cp failed: ${srcPath} -> container:${destPath}`);
      console.error(result.stderr);
      throw new Error(`docker cp to failed: ${result.stderr}`);
    }
  }

  async copyFrom(
    container: ContainerHandle,
    srcPath: string,
    destPath: string,
  ): Promise<void> {
    const result = await runCommand([
      "docker",
      "cp",
      `${container.id}:${srcPath}`,
      destPath,
    ]);
    if (result.code !== 0) {
      console.error(`\nDocker cp failed: container:${srcPath} -> ${destPath}`);
      console.error(result.stderr);
      throw new Error(`docker cp from failed: ${result.stderr}`);
    }
  }

  async remove(container: ContainerHandle): Promise<void> {
    await runCommand(["docker", "rm", "-f", container.id]);
  }
}
