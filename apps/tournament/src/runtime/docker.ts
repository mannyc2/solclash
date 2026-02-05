/** ContainerRuntime backed by real Docker. Used in production. */
import {
  runCommand,
  type ContainerHandle,
  type ContainerRuntime,
  type CreateContainerOptions,
  type ExecOptions,
  type ExecResult,
} from "./container.js";

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
    if (options.volumes) {
      for (const vol of options.volumes) {
        const flag = vol.readOnly
          ? `${vol.hostPath}:${vol.containerPath}:ro`
          : `${vol.hostPath}:${vol.containerPath}`;
        args.push("-v", flag);
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
    // Wrap in sh -c so output also goes to PID 1's stdout/stderr,
    // making it visible in Docker Desktop's log viewer.
    const escaped = command
      .map((c) => `'${c.replace(/'/g, "'\\''")}'`)
      .join(" ");
    args.push(
      container.id,
      "bash",
      "-c",
      `${escaped} > >(tee /proc/1/fd/1) 2> >(tee /proc/1/fd/2 >&2)`,
    );
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
    console.log(
      "FILE_WRITE",
      "copy_to",
      srcPath,
      `${container.id}:${destPath}`,
      `container=${container.id.slice(0, 12)}`,
    );
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
    console.log(
      "FILE_WRITE",
      "copy_from",
      `${container.id}:${srcPath}`,
      destPath,
      `container=${container.id.slice(0, 12)}`,
    );
  }

  async remove(container: ContainerHandle): Promise<void> {
    await runCommand(["docker", "rm", "-f", container.id]);
  }
}
