import { Buffer } from "node:buffer";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    const value = args[i + 1];
    if (key === "--input") {
      out.input = value;
      i += 1;
    } else if (key === "--log-dir") {
      out.logDir = value;
      i += 1;
    }
  }
  return out;
}

function normalizeAllowlist(policy) {
  if (!policy || !Array.isArray(policy.allowlist)) return [];
  return policy.allowlist.filter((item) => item.length > 0);
}

function matchAllowlist(url, allowlist) {
  if (!allowlist || allowlist.length === 0) return false;
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  for (const entry of allowlist) {
    if (entry.startsWith("*.") && host.endsWith(entry.slice(1))) return true;
    if (entry === host) return true;
  }
  return false;
}

function buildNetworkHook(policy) {
  if (!policy || !policy.enabled) return null;
  const allowlist = normalizeAllowlist(policy);
  return async (input) => {
    if (input.tool_name !== "WebFetch") return {};
    const url = input.tool_input?.url ?? "";
    if (!matchAllowlist(url, allowlist)) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "URL not in allowlist",
        },
      };
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    };
  };
}

/**
 * Spawn a CLI process and capture stdout/stderr.
 * Uses node:child_process.spawn for QEMU compatibility (Bun $ crashes under QEMU).
 * Returns { code, stdout, stderr }.
 */
function spawnCli(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    proc.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    proc.on("error", (err) => {
      // AbortError means we timed out
      if (err.name === "AbortError") {
        resolve({
          code: -1,
          stdout: Buffer.concat(stdoutChunks).toString(),
          stderr: "timeout",
        });
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
      });
    });
  });
}

function redact(value) {
  if (!value || value.length <= 12) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function previewText(text, max = 160) {
  const compact = String(text).replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)}...`;
}

// ── Claude SDK session (anthropic, kimi, glm) ──────────────────────

async function runClaudeSession(input, logDir) {
  // Diagnostic: log which provider-relevant env vars are present.
  const diagnosticEnvKeys = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "GLM_API_KEY",
    "GLM_BASE_URL",
    "KIMI_API_KEY",
    "KIMI_BASE_URL",
  ];
  const envDiag = diagnosticEnvKeys
    .filter((k) => process.env[k])
    .map((k) => `${k}=${redact(process.env[k])}`)
    .join(", ");
  console.log(
    `[edit-runner] provider=${input.provider} model=${input.model ?? "default"} env=[${envDiag}]`,
  );

  const logStream = createWriteStream(join(logDir, "sdk.jsonl"), {
    flags: "a",
  });

  let sessionId;
  let checkpointId;
  let status = "failure";
  let error;

  const abortController = new AbortController();
  let timeoutHandle;
  if (input.timeout_ms && input.timeout_ms > 0) {
    timeoutHandle = setTimeout(() => abortController.abort(), input.timeout_ms);
  }

  const allowedTools = [...(input.tool_allowlist ?? [])];
  if (input.network_policy?.enabled && !allowedTools.includes("WebFetch")) {
    allowedTools.push("WebFetch");
  }

  const hooks = {};
  const networkHook = buildNetworkHook(input.network_policy);
  if (networkHook) {
    hooks.PreToolUse = [{ matcher: ".*", hooks: [networkHook] }];
  }

  try {
    console.log(`[edit-runner] Starting Claude SDK query...`);
    const response = query({
      prompt: input.system_prompt,
      options: {
        systemPrompt: input.system_prompt,
        cwd: input.workspace_path,
        maxTurns: input.max_turns ?? 30,
        permissionMode: "acceptEdits",
        allowedTools,
        sandbox: {
          enabled: input.sandbox_enabled ?? true,
          autoAllowBashIfSandboxed: true,
        },
        settingSources: input.settings_sources ?? [],
        abortController,
        enableFileCheckpointing: true,
        extraArgs: { "replay-user-messages": null },
        env: {
          ...process.env,
          CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: "1",
        },
        hooks,
        model: input.model,
      },
    });

    let messageCount = 0;
    for await (const message of response) {
      logStream.write(`${JSON.stringify(message)}\n`);
      messageCount++;
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
        console.log(`[edit-runner] SDK init: session_id=${sessionId}`);
      }
      if (message.type === "user" && message.uuid && !checkpointId) {
        checkpointId = message.uuid;
      }
      if (message.type === "result") {
        console.log(
          `[edit-runner] SDK result: subtype=${message.subtype} messages=${messageCount}`,
        );
        if (message.subtype === "success") {
          status = "success";
        } else if (message.subtype === "error_max_turns") {
          status = "timeout";
          error = "max_turns";
        } else {
          status = "failure";
          error = message.subtype;
          // Log extra detail from the result message for debugging.
          if (message.error) {
            console.error(`[edit-runner] SDK error detail:`, message.error);
          }
        }
      }
    }
    console.log(
      `[edit-runner] SDK stream ended: ${messageCount} messages, status=${status}`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    console.error(`[edit-runner] SDK threw: ${errMsg}`);
    if (errStack) console.error(`[edit-runner] Stack: ${errStack}`);
    if (abortController.signal.aborted) {
      status = "timeout";
      error = "timeout";
    } else {
      status = "failure";
      error = errMsg;
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    logStream.end();
  }

  return { status, sessionId, checkpointId, error };
}

// ── Gemini CLI session (google) ─────────────────────────────────────

async function runGeminiSession(input, logDir) {
  const abortController = new AbortController();
  let timeoutHandle;
  if (input.timeout_ms && input.timeout_ms > 0) {
    timeoutHandle = setTimeout(() => abortController.abort(), input.timeout_ms);
  }

  let status = "failure";
  let error;

  try {
    const args = ["-p", input.system_prompt];
    if (input.model) {
      args.push("-m", input.model);
    }

    const result = await spawnCli("gemini", args, {
      cwd: input.workspace_path,
      signal: abortController.signal,
    });

    const geminiOutputPath = join(logDir, "gemini_output.log");
    await writeFile(
      geminiOutputPath,
      result.stdout + "\n---STDERR---\n" + result.stderr,
    );
    console.log(
      "FILE_WRITE",
      "write",
      geminiOutputPath,
      `exit=${result.code}`,
      `stdout=${previewText(result.stdout)}`,
      `stderr=${previewText(result.stderr)}`,
    );

    if (result.code === 0) {
      status = "success";
    } else if (result.code === 53 || result.code === -1) {
      status = "timeout";
      error = result.code === -1 ? "timeout" : "turn_limit";
    } else if (result.code === 41) {
      status = "failure";
      error = "auth_fail";
    } else {
      status = "failure";
      error = `exit_code_${result.code}`;
    }
  } catch (err) {
    status = "failure";
    error = err instanceof Error ? err.message : "unknown_error";
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  return { status, sessionId: undefined, checkpointId: undefined, error };
}

// ── Codex CLI session (openai) ──────────────────────────────────────

async function runCodexSession(input, logDir) {
  const abortController = new AbortController();
  let timeoutHandle;
  if (input.timeout_ms && input.timeout_ms > 0) {
    timeoutHandle = setTimeout(() => abortController.abort(), input.timeout_ms);
  }

  let status = "failure";
  let error;

  try {
    const args = [
      "exec",
      input.system_prompt,
      "--full-auto",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "-C",
      input.workspace_path,
    ];
    if (input.model) {
      args.push("-m", input.model);
    }

    const result = await spawnCli("codex", args, {
      cwd: input.workspace_path,
      signal: abortController.signal,
    });

    const codexOutputPath = join(logDir, "codex_output.log");
    await writeFile(
      codexOutputPath,
      result.stdout + "\n---STDERR---\n" + result.stderr,
    );
    console.log(
      "FILE_WRITE",
      "write",
      codexOutputPath,
      `exit=${result.code}`,
      `stdout=${previewText(result.stdout)}`,
      `stderr=${previewText(result.stderr)}`,
    );

    if (result.code === 0) {
      status = "success";
    } else if (result.code === 53 || result.code === -1) {
      status = "timeout";
      error = result.code === -1 ? "timeout" : "turn_limit";
    } else if (result.code === 41) {
      status = "failure";
      error = "auth_fail";
    } else {
      status = "failure";
      error = `exit_code_${result.code}`;
    }
  } catch (err) {
    status = "failure";
    error = err instanceof Error ? err.message : "unknown_error";
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  return { status, sessionId: undefined, checkpointId: undefined, error };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const { input: inputPath, logDir } = parseArgs();
  if (!inputPath || !logDir) {
    console.error("Usage: edit-runner --input <path> --log-dir <path>");
    process.exit(1);
  }

  await mkdir(logDir, { recursive: true });
  const inputRaw = await readFile(inputPath, "utf8");
  const input = JSON.parse(inputRaw);

  let result;
  if (input.provider === "google") {
    result = await runGeminiSession(input, logDir);
  } else if (input.provider === "openai") {
    result = await runCodexSession(input, logDir);
  } else {
    // anthropic, kimi, glm all use Claude SDK
    result = await runClaudeSession(input, logDir);
  }

  const { status, sessionId, checkpointId, error } = result;

  const meta = {
    agent_id: input.agent_id,
    status,
    session_id: sessionId,
    checkpoint_id: checkpointId,
    error,
    prompt_ref: input.prompt_ref,
    prompt_sha256: input.prompt_sha256,
    prompt_path: input.prompt_path,
  };
  const metaPath = join(logDir, "edit_meta.json");
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  console.log(
    "FILE_WRITE",
    "write",
    metaPath,
    `agent=${input.agent_id}`,
    `status=${status}`,
    `error=${error ?? "none"}`,
  );

  if (status === "success") {
    process.exit(0);
  }
  if (status === "timeout") {
    process.exit(10);
  }
  process.exit(1);
}

main();
