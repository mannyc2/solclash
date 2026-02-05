/**
 * Edit phase — gives each agent a Claude Code session to modify its source.
 *
 * For each non-builtin agent:
 *   1. Spin up a container with the agent's workspace mounted.
 *   2. Write an edit_input.json describing the prompt, constraints, and model.
 *   3. Run the edit-runner script (a thin Claude Code wrapper) inside the container.
 *   4. If the session succeeds, copy the modified workspace back to the host
 *      so the competition phase uses the updated code.
 *   5. Write edit_meta.json with the session outcome for debugging.
 *
 * Agents run concurrently up to config.concurrency (default 4).
 */
import { mkdir, mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCommand, type ContainerRuntime } from "../runtime/container.js";
import type { AgentSource } from "../runner.js";
import { getProviderEnvDefaults } from "../runner.js";
import type { EditConfig, EditSessionOutput } from "./config.js";
import { resolveEditPrompt } from "./prompt.js";

interface EditPhaseOpts {
  round: number;
  agents: AgentSource[];
  config: EditConfig;
  prompt_ref: string;
  runtime: ContainerRuntime;
  logsRoot: string;
}

async function replaceDirContents(dest: string, src: string): Promise<void> {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  const result = await runCommand(["cp", "-R", `${src}/.`, dest]);
  if (result.code !== 0) {
    throw new Error(`Failed to sync workspace: ${result.stderr}`);
  }
}

async function readJsonFile(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await Bun.file(path).json();
  } catch {
    return null;
  }
}

/**
 * docker cp sometimes nests the copied dir inside a "workspace/" subdirectory
 * depending on whether the source path ended with "/." or not. This function
 * detects that and returns the actual workspace root.
 */
async function resolveCopiedWorkspace(root: string): Promise<string> {
  const candidate = join(root, "workspace");
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      return candidate;
    }
  } catch {
    // ignore
  }
  return root;
}

async function runEditSession(
  agent: AgentSource,
  opts: EditPhaseOpts,
): Promise<EditSessionOutput> {
  console.log(`  ${agent.id}: Starting edit session...`);
  const { round, config, prompt_ref, runtime, logsRoot } = opts;
  const prompt = resolveEditPrompt(prompt_ref, round, agent.id);
  if (!agent.workspace) {
    return {
      status: "failure",
      error: "missing_workspace",
      log_dir: "",
    };
  }

  const logDirHost = join(logsRoot, "edits", `${round}`, agent.id);
  await mkdir(logDirHost, { recursive: true });

  const providerDefaults =
    agent.provider !== "builtin"
      ? getProviderEnvDefaults(agent.provider)
      : getProviderEnvDefaults("anthropic");
  const env: Record<string, string> = {};
  const apiKey = process.env[providerDefaults.api_key_env];
  if (apiKey) env[providerDefaults.api_key_env] = apiKey;
  const baseUrl = process.env[providerDefaults.base_url_env];
  if (baseUrl) env[providerDefaults.base_url_env] = baseUrl;
  env.SOLCLASH_AGENT_ID = agent.id;

  const container = await runtime.create({
    image: config.image,
    workdir: "/",
    env,
  });

  const logDirContainer = `/logs/edits/${round}/${agent.id}`;
  const inputContainer = `/tmp/edit-input-${agent.id}.json`;
  const workspaceContainer = "/workspace";
  const hostRoot = container.id;
  const hostLogDir = join(hostRoot, logDirContainer.slice(1));
  const hostInputPath = join(hostRoot, inputContainer.slice(1));
  const hostWorkspace = join(hostRoot, workspaceContainer.slice(1));
  const tempWorkspaceDir = await mkdtemp(
    join(tmpdir(), `solclash-edit-workspace-${agent.id}-`),
  );

  let status: EditSessionOutput["status"] = "failure";
  let sessionId: string | undefined;
  let checkpointId: string | undefined;
  let error: string | undefined;

  try {
    if (runtime.kind === "host") {
      await mkdir(hostWorkspace, { recursive: true });
      await mkdir(hostLogDir, { recursive: true });
      await mkdir(join(hostRoot, "tmp"), { recursive: true });
    } else {
      await runtime.exec(container, [
        "mkdir",
        "-p",
        workspaceContainer,
        logDirContainer,
      ]);
    }
    // Copy workspace contents into container.
    await runtime.copyTo(container, `${agent.workspace}/.`, workspaceContainer);

    const input = {
      round,
      agent_id: agent.id,
      workspace_path:
        runtime.kind === "host" ? hostWorkspace : workspaceContainer,
      system_prompt: prompt.content,
      max_turns: config.max_turns,
      tool_allowlist: config.tool_allowlist,
      sandbox_enabled: config.sandbox_enabled,
      network_policy: config.network_policy,
      settings_sources: config.settings_sources,
      timeout_ms: config.timeout_ms,
      model: config.model ?? agent.model,
      prompt_ref: prompt.ref,
      prompt_sha256: prompt.sha256,
      prompt_path: prompt.path,
    };

    const inputHost = join(logDirHost, "edit_input.json");
    await writeFile(inputHost, JSON.stringify(input, null, 2));
    await runtime.copyTo(container, inputHost, inputContainer);

    const runnerBinary = runtime.kind === "host" ? "bun" : "node";
    const execResult = await runtime.exec(
      container,
      [
        runnerBinary,
        config.runner_path,
        "--input",
        runtime.kind === "host" ? hostInputPath : inputContainer,
        "--log-dir",
        runtime.kind === "host" ? hostLogDir : logDirContainer,
      ],
      { env },
    );

    await runtime.copyFrom(container, `${logDirContainer}/.`, logDirHost);

    const metaPath = join(logDirHost, "edit_meta.json");
    const meta = await readJsonFile(metaPath);
    if (meta && typeof meta.status === "string") {
      status = meta.status as EditSessionOutput["status"];
      sessionId =
        typeof meta.session_id === "string" ? meta.session_id : undefined;
      checkpointId =
        typeof meta.checkpoint_id === "string" ? meta.checkpoint_id : undefined;
      error = typeof meta.error === "string" ? meta.error : undefined;
    } else if (execResult.code === 0) {
      status = "success";
    } else if (execResult.code === 10) {
      status = "timeout";
      error = "timeout";
    } else {
      status = "failure";
      error = execResult.stderr || "runner_failed";
    }

    if (status === "success") {
      await runtime.copyFrom(container, "/workspace/.", tempWorkspaceDir);
      const sourceDir = await resolveCopiedWorkspace(tempWorkspaceDir);
      await replaceDirContents(agent.workspace, sourceDir);
    }
  } catch (err) {
    status = "failure";
    error = err instanceof Error ? err.message : "edit_phase_failed";
  } finally {
    await runtime.remove(container);
    await rm(tempWorkspaceDir, { recursive: true, force: true });
  }

  // Log the result
  if (status === "success") {
    console.log(`  ${agent.id}: ✓ Success`);
  } else {
    console.log(`  ${agent.id}: ✗ ${status}${error ? ` - ${error}` : ""}`);
  }

  const hostMeta = {
    agent_id: agent.id,
    status,
    session_id: sessionId,
    checkpoint_id: checkpointId,
    error,
    prompt_ref: prompt.ref,
    prompt_sha256: prompt.sha256,
    prompt_path: prompt.path,
  };
  await writeFile(
    join(logDirHost, "edit_meta.json"),
    JSON.stringify(hostMeta, null, 2),
  );

  return {
    status,
    session_id: sessionId,
    checkpoint_id: checkpointId,
    error,
    log_dir: logDirHost,
  };
}

export async function runEditPhase(
  opts: EditPhaseOpts,
): Promise<Record<string, EditSessionOutput>> {
  const agents = opts.agents.filter((agent) => agent.provider !== "builtin");

  if (agents.length === 0) {
    return {};
  }

  console.log(`\nEdit Phase: Processing ${agents.length} agent(s)...`);

  const results: Record<string, EditSessionOutput> = {};
  const queue = [...agents];

  const concurrency = Math.max(1, opts.config.concurrency);
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const agent = queue.shift();
      if (!agent) return;
      results[agent.id] = await runEditSession(agent, opts);
    }
  });

  await Promise.all(workers);
  return results;
}
