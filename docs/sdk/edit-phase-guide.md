# Edit Phase SDK Guide

Focused guide for implementing the SolClash edit phase harness using the Claude Agent SDK (TypeScript). Maps spec requirements from `docs/solclash-edit-phase-spec.md` to SDK APIs.

For the full API reference, see [reference.md](./reference.md).

---

## Overview

The edit phase is a **one-shot, non-interactive** agent session. Each agent gets:

- A fixed system prompt (deterministic across agents)
- A workspace directory (its codebase root)
- A turn budget (default 30)
- A restricted tool set: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`
- Sandbox-enabled Bash execution
- No human approvals, no network, no filesystem settings

The SDK entry point is `query()` with a string prompt (single-message input mode).

## `query()` — Single-Message Input

For the edit phase, use `query()` with a plain string prompt. This is the one-shot mode — no streaming input, no multi-turn conversation.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const response = query({
  prompt: "Your edit-phase prompt here",
  options: {
    /* ... */
  },
});

for await (const message of response) {
  // Process messages as they arrive
  if (message.type === "result") {
    console.log("Exit status:", message.subtype); // 'success' | 'error' | ...
  }
}
```

The `query()` return type is `Query`, an `AsyncGenerator<SDKMessage, void>` with additional methods like `rewindFiles()`.

### Single-message limitations

Single-message input does **not** support:

- Direct image attachments
- Dynamic message queueing
- Real-time interruption
- Hook integration (PreToolUse/PostToolUse hooks still work, but `UserPromptSubmit` hooks do not)
- Natural multi-turn conversations

This is fine for the edit phase — it's a one-shot session by design.

## Options That Matter

These are the `Options` fields relevant to the edit phase harness. The full type is in [reference.md](./reference.md#options).

### Core options

| Option            | Type              | Spec Default                                   | Purpose                                                          |
| ----------------- | ----------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `systemPrompt`    | `string`          | Fixed per tournament                           | Deterministic prompt; do not embed tool docs (SDK injects them)  |
| `cwd`             | `string`          | `workspace_path`                               | Agent's repo root — all file operations resolve relative to this |
| `maxTurns`        | `number`          | `30`                                           | Edit-phase turn budget                                           |
| `permissionMode`  | `PermissionMode`  | `"acceptEdits"`                                | Auto-approve file edits; no human-in-the-loop                    |
| `allowedTools`    | `string[]`        | `["Read","Write","Edit","Glob","Grep","Bash"]` | Restricted tool set (excludes `WebFetch`, `WebSearch`, etc.)     |
| `sandbox`         | `SandboxSettings` | See below                                      | Sandbox all Bash commands                                        |
| `settingSources`  | `SettingSource[]` | `[]`                                           | No filesystem settings — full isolation                          |
| `env`             | `Dict<string>`    | `process.env`                                  | Environment variables passed to the agent process                |
| `abortController` | `AbortController` | `new AbortController()`                        | Cancel the session on timeout                                    |

### Sandbox settings

The `SandboxSettings` type controls Bash command sandboxing:

```typescript
type SandboxSettings = {
  enabled?: boolean;
  autoAllowBashIfSandboxed?: boolean;
  excludedCommands?: string[];
  allowUnsandboxedCommands?: boolean;
  network?: NetworkSandboxSettings;
  ignoreViolations?: SandboxIgnoreViolations;
  enableWeakerNestedSandbox?: boolean;
};
```

For the edit phase:

```typescript
sandbox: {
  enabled: true,
  autoAllowBashIfSandboxed: true,  // No human approval for sandboxed Bash
}
```

- `enabled: true` — all Bash commands run in a sandbox
- `autoAllowBashIfSandboxed: true` — auto-approve Bash without prompting (safe because sandbox restricts what it can do)
- Network is disabled by excluding `WebFetch`/`WebSearch` from `allowedTools`, not via sandbox network settings

### Setting sources

```typescript
type SettingSource = "user" | "project" | "local";
```

For the edit phase, use `settingSources: []` (the default). This prevents agents from loading `CLAUDE.md`, `settings.json`, or any filesystem config — ensuring deterministic, isolated sessions.

## Permission Mode: `acceptEdits`

The edit phase uses `acceptEdits` mode, which auto-approves:

- File edits (`Edit`, `Write` tools)
- Filesystem commands: `mkdir`, `touch`, `rm`, `mv`, `cp`

Other tools (like Bash commands that aren't filesystem operations) still go through permission evaluation, but with `sandbox.autoAllowBashIfSandboxed: true`, sandboxed Bash is also auto-approved.

This means the agent runs fully non-interactively — no `canUseTool` callback needed.

## Session Resume for Retries

If an edit phase fails and you want to retry or inspect state, capture the session ID and resume:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

let sessionId: string | undefined;

const response = query({
  prompt: editPhasePrompt,
  options: editPhaseOptions,
});

for await (const message of response) {
  // Capture session ID from the init message
  if (message.type === "system" && message.subtype === "init") {
    sessionId = message.session_id;
  }
}

// Later — resume the session (e.g., to retry or inspect)
if (sessionId) {
  const resumed = query({
    prompt: "Continue from where you left off",
    options: {
      ...editPhaseOptions,
      resume: sessionId,
    },
  });

  for await (const msg of resumed) {
    // ...
  }
}
```

Use `forkSession: true` to create a new session branch instead of continuing the original.

## File Checkpointing for Rollback

Enable checkpointing to roll back the workspace if the edit phase produces bad output.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const opts = {
  ...editPhaseOptions,
  enableFileCheckpointing: true,
  extraArgs: { "replay-user-messages": null }, // Required to receive checkpoint UUIDs
  env: { ...process.env, CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: "1" },
};

let checkpointId: string | undefined;
let sessionId: string | undefined;

const response = query({ prompt: editPhasePrompt, options: opts });

for await (const message of response) {
  // Capture the first user message UUID as the checkpoint (pre-edit state)
  if (message.type === "user" && message.uuid && !checkpointId) {
    checkpointId = message.uuid;
  }
  if ("session_id" in message && !sessionId) {
    sessionId = message.session_id;
  }
}

// If validation fails, rewind to pre-edit state
if (checkpointId && sessionId) {
  const rewindQuery = query({
    prompt: "", // Empty prompt to open the connection
    options: { ...opts, resume: sessionId },
  });

  for await (const msg of rewindQuery) {
    await rewindQuery.rewindFiles(checkpointId);
    break;
  }
  console.log(`Workspace restored to pre-edit state`);
}
```

> **Warning:** Only changes via `Write`, `Edit`, and `NotebookEdit` tools are tracked. Changes via Bash (e.g., `echo > file.txt`, `sed -i`) are not captured by the checkpoint system.

Checkpointing requires:

1. `enableFileCheckpointing: true`
2. `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1` environment variable
3. `extraArgs: { "replay-user-messages": null }` to receive checkpoint UUIDs in the stream

## Hooks (Optional Monitoring)

Hooks let you observe agent behavior without blocking it. Useful for logging, metrics, or enforcing additional constraints beyond the tool allowlist.

```typescript
import {
  query,
  HookCallback,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

const logToolUse: HookCallback = async (input, toolUseID, { signal }) => {
  const preInput = input as PreToolUseHookInput;
  console.log(`[${preInput.tool_name}] ${JSON.stringify(preInput.tool_input)}`);
  return {}; // Empty object = allow
};

const response = query({
  prompt: editPhasePrompt,
  options: {
    ...editPhaseOptions,
    hooks: {
      PreToolUse: [{ matcher: ".*", hooks: [logToolUse] }],
    },
  },
});
```

Available hook events relevant to the edit phase:

- `PreToolUse` — before a tool executes (can block via `permissionDecision: 'deny'`)
- `PostToolUse` — after a tool executes (read-only observation)
- `Stop` — when the agent finishes (save state, emit metrics)

## Complete Code Skeleton

Wiring the spec requirements to SDK options:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

interface EditPhaseInput {
  agentId: string;
  workspacePath: string;
  systemPrompt: string;
  maxTurns?: number;
  toolAllowlist?: string[];
  sandboxEnabled?: boolean;
}

async function runEditPhase(input: EditPhaseInput) {
  const {
    agentId,
    workspacePath,
    systemPrompt,
    maxTurns = 30,
    toolAllowlist = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    sandboxEnabled = true,
  } = input;

  const controller = new AbortController();

  const opts = {
    systemPrompt,
    cwd: workspacePath,
    maxTurns,
    permissionMode: "acceptEdits" as const,
    allowedTools: toolAllowlist,
    sandbox: {
      enabled: sandboxEnabled,
      autoAllowBashIfSandboxed: true,
    },
    settingSources: [] as const,
    abortController: controller,
    enableFileCheckpointing: true,
    extraArgs: { "replay-user-messages": null },
    env: {
      ...process.env,
      CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: "1",
    },
  };

  let sessionId: string | undefined;
  let checkpointId: string | undefined;
  let exitStatus: string = "unknown";

  const response = query({
    prompt: systemPrompt, // The edit-phase prompt
    options: opts,
  });

  for await (const message of response) {
    if (message.type === "system" && message.subtype === "init") {
      sessionId = message.session_id;
    }
    if (message.type === "user" && message.uuid && !checkpointId) {
      checkpointId = message.uuid;
    }
    if (message.type === "result") {
      exitStatus = message.subtype ?? "success";
    }
  }

  return {
    agentId,
    sessionId,
    checkpointId,
    exitStatus,
    workspacePath,
  };
}
```

## Related Files

| File                                                   | Contents                                                 |
| ------------------------------------------------------ | -------------------------------------------------------- |
| [reference.md](./reference.md)                         | Full TypeScript API reference (Options, Query, types)    |
| [streaming.md](./streaming.md)                         | Output streaming and streaming input mode                |
| [permissions-and-hooks.md](./permissions-and-hooks.md) | Permission modes, hooks, approval handling               |
| [sessions.md](./sessions.md)                           | Session management, forking, file checkpointing          |
| [tools-and-mcp.md](./tools-and-mcp.md)                 | Custom tools, MCP servers, subagents                     |
| [extras.md](./extras.md)                               | Structured output, slash commands, skills, plugins, etc. |
