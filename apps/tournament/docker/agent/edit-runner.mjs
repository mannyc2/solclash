import { createWriteStream } from "node:fs";
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

async function main() {
  const { input: inputPath, logDir } = parseArgs();
  if (!inputPath || !logDir) {
    console.error("Usage: edit-runner --input <path> --log-dir <path>");
    process.exit(1);
  }

  await mkdir(logDir, { recursive: true });
  const inputRaw = await readFile(inputPath, "utf8");
  const input = JSON.parse(inputRaw);

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

    for await (const message of response) {
      logStream.write(`${JSON.stringify(message)}\n`);
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
      }
      if (message.type === "user" && message.uuid && !checkpointId) {
        checkpointId = message.uuid;
      }
      if (message.type === "result") {
        if (message.subtype === "success") {
          status = "success";
        } else if (message.subtype === "error_max_turns") {
          status = "timeout";
          error = "max_turns";
        } else {
          status = "failure";
          error = message.subtype;
        }
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      status = "timeout";
      error = "timeout";
    } else {
      status = "failure";
      error = err instanceof Error ? err.message : "unknown_error";
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    logStream.end();
  }

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
  await writeFile(
    join(logDir, "edit_meta.json"),
    JSON.stringify(meta, null, 2),
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
