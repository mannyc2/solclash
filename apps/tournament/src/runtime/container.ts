/**
 * Container runtime abstraction.
 *
 * Both the edit phase and the competition phase need to run code in an
 * isolated environment. This interface lets us swap between:
 *   - DockerRuntime  — real Docker containers (production)
 *   - HostRuntime    — temp directories on the host (tests, local dev)
 *
 * Both implementations share the runCommand() helper at the bottom of
 * this file for spawning subprocesses and capturing output.
 */
import { spawn } from "bun";

export interface ContainerHandle {
  id: string;
  workdir?: string;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CreateContainerOptions {
  image: string;
  name?: string;
  workdir?: string;
  env?: Record<string, string>;
  volumes?: Array<{
    hostPath: string;
    containerPath: string;
    readOnly?: boolean;
  }>;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface ContainerRuntime {
  kind: "docker" | "host";
  create(options: CreateContainerOptions): Promise<ContainerHandle>;
  exec(
    container: ContainerHandle,
    command: string[],
    options?: ExecOptions,
  ): Promise<ExecResult>;
  copyTo(
    container: ContainerHandle,
    srcPath: string,
    destPath: string,
  ): Promise<void>;
  copyFrom(
    container: ContainerHandle,
    srcPath: string,
    destPath: string,
  ): Promise<void>;
  remove(container: ContainerHandle): Promise<void>;
}

export async function runCommand(
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
