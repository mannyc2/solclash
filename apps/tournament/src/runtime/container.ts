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
