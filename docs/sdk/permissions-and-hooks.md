# Configure permissions

Control how your agent uses tools with permission modes, hooks, and declarative allow/deny rules.

---

The Claude Agent SDK provides permission controls to manage how Claude uses tools. Use permission modes and rules to define what's allowed automatically, and the [`canUseTool` callback](/docs/en/agent-sdk/user-input) to handle everything else at runtime.

> **Note:** This page covers permission modes and rules. To build interactive approval flows where users approve or deny tool requests at runtime, see [Handle approvals and user input](/docs/en/agent-sdk/user-input).

## How permissions are evaluated

When Claude requests a tool, the SDK checks permissions in this order:

1. **Hooks**: Run [hooks](/docs/en/agent-sdk/hooks) first, which can allow, deny, or continue to the next step
2. **Permission rules**: Check rules defined in [settings.json](https://code.claude.com/docs/en/settings#permission-settings) in this order: `deny` rules first (block regardless of other rules), then `allow` rules (permit if matched), then `ask` rules (prompt for approval). These declarative rules let you pre-approve, block, or require approval for specific tools without writing code.
3. **Permission mode**: Apply the active [permission mode](#permission-modes) (`bypassPermissions`, `acceptEdits`, `dontAsk`, etc.)
4. **canUseTool callback**: If not resolved by rules or modes, call your [`canUseTool` callback](/docs/en/agent-sdk/user-input) for a decision

![Permission evaluation flow diagram](/docs/images/agent-sdk/permissions-flow.svg)

This page focuses on **permission modes** (step 3), the static configuration that controls default behavior. For the other steps:

- **Hooks**: run custom code to allow, deny, or modify tool requests. See [Control execution with hooks](/docs/en/agent-sdk/hooks).
- **Permission rules**: configure declarative allow/deny rules in `settings.json`. See [Permission settings](https://code.claude.com/docs/en/settings#permission-settings).
- **canUseTool callback**: prompt users for approval at runtime. See [Handle approvals and user input](/docs/en/agent-sdk/user-input).

## Permission modes

Permission modes provide global control over how Claude uses tools. You can set the permission mode when calling `query()` or change it dynamically during streaming sessions.

### Available modes

The SDK supports these permission modes:

| Mode                | Description                  | Tool behavior                                                                                                                 |
| :------------------ | :--------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| `default`           | Standard permission behavior | No auto-approvals; unmatched tools trigger your `canUseTool` callback                                                         |
| `acceptEdits`       | Auto-accept file edits       | File edits and [filesystem operations](#accept-edits-mode-acceptedits) (`mkdir`, `rm`, `mv`, etc.) are automatically approved |
| `bypassPermissions` | Bypass all permission checks | All tools run without permission prompts (use with caution)                                                                   |
| `plan`              | Planning mode                | No tool execution; Claude plans without making changes                                                                        |

> **Warning:** **Subagent inheritance**: When using `bypassPermissions`, all subagents inherit this mode and it cannot be overridden. Subagents may have different system prompts and less constrained behavior than your main agent. Enabling `bypassPermissions` grants them full, autonomous system access without any approval prompts.

### Set permission mode

You can set the permission mode once when starting a query, or change it dynamically while the session is active.

**At query time**

Pass `permissionMode` (TypeScript) when creating a query. This mode applies for the entire session unless changed dynamically.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

async function main() {
  for await (const message of query({
    prompt: "Help me refactor this code",
    options: {
      permissionMode: "default", // Set the mode here
    },
  })) {
    if ("result" in message) {
      console.log(message.result);
    }
  }
}

main();
```

**During streaming**

Call `setPermissionMode()` (TypeScript) to change the mode mid-session. The new mode takes effect immediately for all subsequent tool requests. This lets you start restrictive and loosen permissions as trust builds, for example switching to `acceptEdits` after reviewing Claude's initial approach.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

async function main() {
  const q = query({
    prompt: "Help me refactor this code",
    options: {
      permissionMode: "default", // Start in default mode
    },
  });

  // Change mode dynamically mid-session
  await q.setPermissionMode("acceptEdits");

  // Process messages with the new permission mode
  for await (const message of q) {
    if ("result" in message) {
      console.log(message.result);
    }
  }
}

main();
```

### Mode details

#### Accept edits mode (`acceptEdits`)

Auto-approves file operations so Claude can edit code without prompting. Other tools (like Bash commands that aren't filesystem operations) still require normal permissions.

**Auto-approved operations:**

- File edits (Edit, Write tools)
- Filesystem commands: `mkdir`, `touch`, `rm`, `mv`, `cp`

**Use when:** you trust Claude's edits and want faster iteration, such as during prototyping or when working in an isolated directory.

#### Bypass permissions mode (`bypassPermissions`)

Auto-approves all tool uses without prompts. Hooks still execute and can block operations if needed.

> **Warning:** Use with extreme caution. Claude has full system access in this mode. Only use in controlled environments where you trust all possible operations.

#### Plan mode (`plan`)

Prevents tool execution entirely. Claude can analyze code and create plans but cannot make changes. Claude may use `AskUserQuestion` to clarify requirements before finalizing the plan. See [Handle approvals and user input](/docs/en/agent-sdk/user-input#handle-clarifying-questions) for handling these prompts.

**Use when:** you want Claude to propose changes without executing them, such as during code review or when you need to approve changes before they're made.

## Related resources

For the other steps in the permission evaluation flow:

- [Handle approvals and user input](/docs/en/agent-sdk/user-input): interactive approval prompts and clarifying questions
- [Hooks guide](/docs/en/agent-sdk/hooks): run custom code at key points in the agent lifecycle
- [Permission rules](https://code.claude.com/docs/en/settings#permission-settings): declarative allow/deny rules in `settings.json`

# Handle approvals and user input

Surface Claude's approval requests and clarifying questions to users, then return their decisions to the SDK.

---

While working on a task, Claude sometimes needs to check in with users. It might need permission before deleting files, or need to ask which database to use for a new project. Your application needs to surface these requests to users so Claude can continue with their input.

Claude requests user input in two situations: when it needs **permission to use a tool** (like deleting files or running commands), and when it has **clarifying questions** (via the `AskUserQuestion` tool). Both trigger your `canUseTool` callback, which pauses execution until you return a response. This is different from normal conversation turns where Claude finishes and waits for your next message.

For clarifying questions, Claude generates the questions and options. Your role is to present them to users and return their selections. You can't add your own questions to this flow; if you need to ask users something yourself, do that separately in your application logic.

This guide shows you how to detect each type of request and respond appropriately.

## Detect when Claude needs input

Pass a `canUseTool` callback in your query options. The callback fires whenever Claude needs user input, receiving the tool name and input as arguments:

```typescript
async function handleToolRequest(toolName, input) {
  // Prompt user and return allow or deny
}

const options = { canUseTool: handleToolRequest };
```

The callback fires in two cases:

1. **Tool needs approval**: Claude wants to use a tool that isn't auto-approved by [permission rules](/docs/en/agent-sdk/permissions) or modes. Check `tool_name` for the tool (e.g., `"Bash"`, `"Write"`).
2. **Claude asks a question**: Claude calls the `AskUserQuestion` tool. Check if `tool_name == "AskUserQuestion"` to handle it differently. If you specify a `tools` array, include `AskUserQuestion` for this to work. See [Handle clarifying questions](#handle-clarifying-questions) for details.

Your callback must return within **60 seconds** or Claude will assume the request was denied and try a different approach.

> **Note:** To automatically allow or deny tools without prompting users, use [hooks](/docs/en/agent-sdk/hooks) instead. Hooks execute before `canUseTool` and can allow, deny, or modify requests based on your own logic. You can also use the [`PermissionRequest` hook](/docs/en/agent-sdk/hooks#available-hooks) to send external notifications (Slack, email, push) when Claude is waiting for approval.

## Handle tool approval requests

Once you've passed a `canUseTool` callback in your query options, it fires when Claude wants to use a tool that isn't auto-approved. Your callback receives two arguments:

| Argument   | Description                                                                    |
| ---------- | ------------------------------------------------------------------------------ |
| `toolName` | The name of the tool Claude wants to use (e.g., `"Bash"`, `"Write"`, `"Edit"`) |
| `input`    | The parameters Claude is passing to the tool. Contents vary by tool.           |

The `input` object contains tool-specific parameters. Common examples:

| Tool    | Input fields                            |
| ------- | --------------------------------------- |
| `Bash`  | `command`, `description`, `timeout`     |
| `Write` | `file_path`, `content`                  |
| `Edit`  | `file_path`, `old_string`, `new_string` |
| `Read`  | `file_path`, `offset`, `limit`          |

See the SDK reference for complete input schemas: [Python](/docs/en/agent-sdk/python#tool-inputoutput-types) | [TypeScript](/docs/en/agent-sdk/typescript#tool-input-types).

You can display this information to the user so they can decide whether to allow or reject the action, then return the appropriate response.

The following example asks Claude to create and delete a test file. When Claude attempts each operation, the callback prints the tool request to the terminal and prompts for y/n approval.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import * as readline from "readline";

// Helper to prompt user for input in the terminal
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

for await (const message of query({
  prompt: "Create a test file in /tmp and then delete it",
  options: {
    canUseTool: async (toolName, input) => {
      // Display the tool request
      console.log(`\nTool: ${toolName}`);
      if (toolName === "Bash") {
        console.log(`Command: ${input.command}`);
        if (input.description) console.log(`Description: ${input.description}`);
      } else {
        console.log(`Input: ${JSON.stringify(input, null, 2)}`);
      }

      // Get user approval
      const response = await prompt("Allow this action? (y/n): ");

      // Return allow or deny based on user's response
      if (response.toLowerCase() === "y") {
        // Allow: tool executes with the original (or modified) input
        return { behavior: "allow", updatedInput: input };
      } else {
        // Deny: tool doesn't execute, Claude sees the message
        return { behavior: "deny", message: "User denied this action" };
      }
    },
  },
})) {
  if ("result" in message) console.log(message.result);
}
```

> **Note:** In Python, `can_use_tool` requires [streaming mode](/docs/en/agent-sdk/streaming-vs-single-mode) and a `PreToolUse` hook that returns `{"continue_": True}` to keep the stream open. Without this hook, the stream closes before the permission callback can be invoked.

This example uses a `y/n` flow where any input other than `y` is treated as a denial. In practice, you might build a richer UI that lets users modify the request, provide feedback, or redirect Claude entirely. See [Respond to tool requests](#respond-to-tool-requests) for all the ways you can respond.

### Respond to tool requests

Your callback returns one of two response types:

| Response  | Python                                     | TypeScript                            |
| --------- | ------------------------------------------ | ------------------------------------- |
| **Allow** | `PermissionResultAllow(updated_input=...)` | `{ behavior: "allow", updatedInput }` |
| **Deny**  | `PermissionResultDeny(message=...)`        | `{ behavior: "deny", message }`       |

When allowing, pass the tool input (original or modified). When denying, provide a message explaining why. Claude sees this message and may adjust its approach.

```typescript
// Allow the tool to execute
return { behavior: "allow", updatedInput: input };

// Block the tool
return { behavior: "deny", message: "User rejected this action" };
```

Beyond allowing or denying, you can modify the tool's input or provide context that helps Claude adjust its approach:

- **Approve**: let the tool execute as Claude requested
- **Approve with changes**: modify the input before execution (e.g., sanitize paths, add constraints)
- **Reject**: block the tool and tell Claude why
- **Suggest alternative**: block but guide Claude toward what the user wants instead
- **Redirect entirely**: use [streaming input](/docs/en/agent-sdk/streaming-vs-single-mode) to send Claude a completely new instruction

**Approve**

The user approves the action as-is. Pass through the `input` from your callback unchanged and the tool executes exactly as Claude requested.

```typescript
canUseTool: async (toolName, input) => {
  console.log(`Claude wants to use ${toolName}`);
  const approved = await askUser("Allow this action?");

  if (approved) {
    return { behavior: "allow", updatedInput: input };
  }
  return { behavior: "deny", message: "User declined" };
};
```

**Approve with changes**

The user approves but wants to modify the request first. You can change the input before the tool executes. Claude sees the result but isn't told you changed anything. Useful for sanitizing parameters, adding constraints, or scoping access.

```typescript
canUseTool: async (toolName, input) => {
  if (toolName === "Bash") {
    // User approved, but scope all commands to sandbox
    const sandboxedInput = {
      ...input,
      command: input.command.replace("/tmp", "/tmp/sandbox"),
    };
    return { behavior: "allow", updatedInput: sandboxedInput };
  }
  return { behavior: "allow", updatedInput: input };
};
```

**Reject**

The user doesn't want this action to happen. Block the tool and provide a message explaining why. Claude sees this message and may try a different approach.

```typescript
canUseTool: async (toolName, input) => {
  const approved = await askUser(`Allow ${toolName}?`);

  if (!approved) {
    return {
      behavior: "deny",
      message: "User rejected this action",
    };
  }
  return { behavior: "allow", updatedInput: input };
};
```

**Suggest alternative**

The user doesn't want this specific action, but has a different idea. Block the tool and include guidance in your message. Claude will read this and decide how to proceed based on your feedback.

```typescript
canUseTool: async (toolName, input) => {
  if (toolName === "Bash" && input.command.includes("rm")) {
    // User doesn't want to delete, suggest archiving instead
    return {
      behavior: "deny",
      message:
        "User doesn't want to delete files. They asked if you could compress them into an archive instead.",
    };
  }
  return { behavior: "allow", updatedInput: input };
};
```

**Redirect entirely**

For a complete change of direction (not just a nudge), use [streaming input](/docs/en/agent-sdk/streaming-vs-single-mode) to send Claude a new instruction directly. This bypasses the current tool request and gives Claude entirely new instructions to follow.

## Handle clarifying questions

When Claude needs more direction on a task with multiple valid approaches, it calls the `AskUserQuestion` tool. This triggers your `canUseTool` callback with `toolName` set to `AskUserQuestion`. The input contains Claude's questions as multiple-choice options, which you display to the user and return their selections.

> **Tip:** Clarifying questions are especially common in [`plan` mode](/docs/en/agent-sdk/permissions#plan-mode-plan), where Claude explores the codebase and asks questions before proposing a plan. This makes plan mode ideal for interactive workflows where you want Claude to gather requirements before making changes.

The following steps show how to handle clarifying questions:

**Step 1: Pass a canUseTool callback**

Pass a `canUseTool` callback in your query options. By default, `AskUserQuestion` is available. If you specify a `tools` array to restrict Claude's capabilities (for example, a read-only agent with only `Read`, `Glob`, and `Grep`), include `AskUserQuestion` in that array. Otherwise, Claude won't be able to ask clarifying questions:

```typescript
for await (const message of query({
  prompt: "Analyze this codebase",
  options: {
    // Include AskUserQuestion in your tools list
    tools: ["Read", "Glob", "Grep", "AskUserQuestion"],
    canUseTool: async (toolName, input) => {
      // Handle clarifying questions here
    },
  },
})) {
  // ...
}
```

**Step 2: Detect AskUserQuestion**

In your callback, check if `toolName` equals `AskUserQuestion` to handle it differently from other tools:

```typescript
canUseTool: async (toolName, input) => {
  if (toolName === "AskUserQuestion") {
    // Your implementation to collect answers from the user
    return handleClarifyingQuestions(input);
  }
  // Handle other tools normally
  return promptForApproval(toolName, input);
};
```

**Step 3: Parse the question input**

The input contains Claude's questions in a `questions` array. Each question has a `question` (the text to display), `options` (the choices), and `multiSelect` (whether multiple selections are allowed):

```json
{
  "questions": [
    {
      "question": "How should I format the output?",
      "header": "Format",
      "options": [
        { "label": "Summary", "description": "Brief overview" },
        { "label": "Detailed", "description": "Full explanation" }
      ],
      "multiSelect": false
    },
    {
      "question": "Which sections should I include?",
      "header": "Sections",
      "options": [
        { "label": "Introduction", "description": "Opening context" },
        { "label": "Conclusion", "description": "Final summary" }
      ],
      "multiSelect": true
    }
  ]
}
```

See [Question format](#question-format) for full field descriptions.

**Step 4: Collect answers from the user**

Present the questions to the user and collect their selections. How you do this depends on your application: a terminal prompt, a web form, a mobile dialog, etc.

**Step 5: Return answers to Claude**

Build the `answers` object as a record where each key is the `question` text and each value is the selected option's `label`:

| From the question object                                     | Use as |
| ------------------------------------------------------------ | ------ |
| `question` field (e.g., `"How should I format the output?"`) | Key    |
| Selected option's `label` field (e.g., `"Summary"`)          | Value  |

For multi-select questions, join multiple labels with `", "`. If you [support free-text input](#support-free-text-input), use the user's custom text as the value.

```typescript
return {
  behavior: "allow",
  updatedInput: {
    questions: input.questions,
    answers: {
      "How should I format the output?": "Summary",
      "Which sections should I include?": "Introduction, Conclusion",
    },
  },
};
```

### Question format

The input contains Claude's generated questions in a `questions` array. Each question has these fields:

| Field         | Description                                               |
| ------------- | --------------------------------------------------------- |
| `question`    | The full question text to display                         |
| `header`      | Short label for the question (max 12 characters)          |
| `options`     | Array of 2-4 choices, each with `label` and `description` |
| `multiSelect` | If `true`, users can select multiple options              |

Here's an example of the structure you'll receive:

```json
{
  "questions": [
    {
      "question": "How should I format the output?",
      "header": "Format",
      "options": [
        { "label": "Summary", "description": "Brief overview of key points" },
        { "label": "Detailed", "description": "Full explanation with examples" }
      ],
      "multiSelect": false
    }
  ]
}
```

### Response format

Return an `answers` object mapping each question's `question` field to the selected option's `label`:

| Field       | Description                                                              |
| ----------- | ------------------------------------------------------------------------ |
| `questions` | Pass through the original questions array (required for tool processing) |
| `answers`   | Object where keys are question text and values are selected labels       |

For multi-select questions, join multiple labels with `", "`. For free-text input, use the user's custom text directly.

```json
{
  "questions": [...],
  "answers": {
    "How should I format the output?": "Summary",
    "Which sections should I include?": "Introduction, Conclusion"
  }
}
```

#### Support free-text input

Claude's predefined options won't always cover what users want. To let users type their own answer:

- Display an additional "Other" choice after Claude's options that accepts text input
- Use the user's custom text as the answer value (not the word "Other")

See the [complete example](#complete-example) below for a full implementation.

### Complete example

Claude asks clarifying questions when it needs user input to proceed. For example, when asked to help decide on a tech stack for a mobile app, Claude might ask about cross-platform vs native, backend preferences, or target platforms. These questions help Claude make decisions that match the user's preferences rather than guessing.

This example handles those questions in a terminal application. Here's what happens at each step:

1. **Route the request**: The `canUseTool` callback checks if the tool name is `"AskUserQuestion"` and routes to a dedicated handler
2. **Display questions**: The handler loops through the `questions` array and prints each question with numbered options
3. **Collect input**: The user can enter a number to select an option, or type free text directly (e.g., "jquery", "i don't know")
4. **Map answers**: The code checks if input is numeric (uses the option's label) or free text (uses the text directly)
5. **Return to Claude**: The response includes both the original `questions` array and the `answers` mapping

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import * as readline from "readline";

// Helper to prompt user for input in the terminal
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

// Parse user input as option number(s) or free text
function parseResponse(response: string, options: any[]): string {
  const indices = response.split(",").map((s) => parseInt(s.trim()) - 1);
  const labels = indices
    .filter((i) => !isNaN(i) && i >= 0 && i < options.length)
    .map((i) => options[i].label);
  return labels.length > 0 ? labels.join(", ") : response;
}

// Display Claude's questions and collect user answers
async function handleAskUserQuestion(input: any) {
  const answers: Record<string, string> = {};

  for (const q of input.questions) {
    console.log(`\n${q.header}: ${q.question}`);

    const options = q.options;
    options.forEach((opt: any, i: number) => {
      console.log(`  ${i + 1}. ${opt.label} - ${opt.description}`);
    });
    if (q.multiSelect) {
      console.log(
        "  (Enter numbers separated by commas, or type your own answer)",
      );
    } else {
      console.log("  (Enter a number, or type your own answer)");
    }

    const response = (await prompt("Your choice: ")).trim();
    answers[q.question] = parseResponse(response, options);
  }

  // Return the answers to Claude (must include original questions)
  return {
    behavior: "allow",
    updatedInput: { questions: input.questions, answers },
  };
}

async function main() {
  for await (const message of query({
    prompt: "Help me decide on the tech stack for a new mobile app",
    options: {
      canUseTool: async (toolName, input) => {
        // Route AskUserQuestion to our question handler
        if (toolName === "AskUserQuestion") {
          return handleAskUserQuestion(input);
        }
        // Auto-approve other tools for this example
        return { behavior: "allow", updatedInput: input };
      },
    },
  })) {
    if ("result" in message) console.log(message.result);
  }
}

main();
```

## Limitations

- **60-second timeout**: `canUseTool` callbacks must return within 60 seconds or Claude will retry with a different approach
- **Subagents**: `AskUserQuestion` is not currently available in subagents spawned via the Task tool
- **Question limits**: each `AskUserQuestion` call supports 1-4 questions with 2-4 options each

## Other ways to get user input

The `canUseTool` callback and `AskUserQuestion` tool cover most approval and clarification scenarios, but the SDK offers other ways to get input from users:

### Streaming input

Use [streaming input](/docs/en/agent-sdk/streaming-vs-single-mode) when you need to:

- **Interrupt the agent mid-task**: send a cancel signal or change direction while Claude is working
- **Provide additional context**: add information Claude needs without waiting for it to ask
- **Build chat interfaces**: let users send follow-up messages during long-running operations

Streaming input is ideal for conversational UIs where users interact with the agent throughout execution, not just at approval checkpoints.

### Custom tools

Use [custom tools](/docs/en/agent-sdk/custom-tools) when you need to:

- **Collect structured input**: build forms, wizards, or multi-step workflows that go beyond `AskUserQuestion`'s multiple-choice format
- **Integrate external approval systems**: connect to existing ticketing, workflow, or approval platforms
- **Implement domain-specific interactions**: create tools tailored to your application's needs, like code review interfaces or deployment checklists

Custom tools give you full control over the interaction, but require more implementation work than using the built-in `canUseTool` callback.

## Related resources

- [Configure permissions](/docs/en/agent-sdk/permissions): set up permission modes and rules
- [Control execution with hooks](/docs/en/agent-sdk/hooks): run custom code at key points in the agent lifecycle
- [TypeScript SDK reference](/docs/en/agent-sdk/typescript#canusetool): full canUseTool API documentation

# Intercept and control agent behavior with hooks

Intercept and customize agent behavior at key execution points with hooks

---

Hooks let you intercept agent execution at key points to add validation, logging, security controls, or custom logic. With hooks, you can:

- **Block dangerous operations** before they execute, like destructive shell commands or unauthorized file access
- **Log and audit** every tool call for compliance, debugging, or analytics
- **Transform inputs and outputs** to sanitize data, inject credentials, or redirect file paths
- **Require human approval** for sensitive actions like database writes or API calls
- **Track session lifecycle** to manage state, clean up resources, or send notifications

A hook has two parts:

1. **The callback function**: the logic that runs when the hook fires
2. **The hook configuration**: tells the SDK which event to hook into (like `PreToolUse`) and which tools to match

The following example blocks the agent from modifying `.env` files. First, define a callback that checks the file path, then pass it to `query()` to run before any Write or Edit tool call:

```typescript
import {
  query,
  HookCallback,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

// Define a hook callback with the HookCallback type
const protectEnvFiles: HookCallback = async (input, toolUseID, { signal }) => {
  // Cast input to the specific hook type for type safety
  const preInput = input as PreToolUseHookInput;

  // Extract the file path from the tool's input arguments
  const filePath = preInput.tool_input?.file_path as string;
  const fileName = filePath?.split("/").pop();

  // Block the operation if targeting a .env file
  if (fileName === ".env") {
    return {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: "deny",
        permissionDecisionReason: "Cannot modify .env files",
      },
    };
  }

  // Return empty object to allow the operation
  return {};
};

for await (const message of query({
  prompt: "Update the database configuration",
  options: {
    hooks: {
      // Register the hook for PreToolUse events
      // The matcher filters to only Write and Edit tool calls
      PreToolUse: [{ matcher: "Write|Edit", hooks: [protectEnvFiles] }],
    },
  },
})) {
  console.log(message);
}
```

This is a `PreToolUse` hook. It runs before the tool executes and can block or allow operations based on your logic. The rest of this guide covers all available hooks, their configuration options, and patterns for common use cases.

## Available hooks

The SDK provides hooks for different stages of agent execution. Some hooks are available in both SDKs, while others are TypeScript-only because the Python SDK doesn't support them.

| Hook Event           | Python SDK | TypeScript SDK | What triggers it                        | Example use case                                |
| -------------------- | ---------- | -------------- | --------------------------------------- | ----------------------------------------------- |
| `PreToolUse`         | Yes        | Yes            | Tool call request (can block or modify) | Block dangerous shell commands                  |
| `PostToolUse`        | Yes        | Yes            | Tool execution result                   | Log all file changes to audit trail             |
| `PostToolUseFailure` | No         | Yes            | Tool execution failure                  | Handle or log tool errors                       |
| `UserPromptSubmit`   | Yes        | Yes            | User prompt submission                  | Inject additional context into prompts          |
| `Stop`               | Yes        | Yes            | Agent execution stop                    | Save session state before exit                  |
| `SubagentStart`      | No         | Yes            | Subagent initialization                 | Track parallel task spawning                    |
| `SubagentStop`       | Yes        | Yes            | Subagent completion                     | Aggregate results from parallel tasks           |
| `PreCompact`         | Yes        | Yes            | Conversation compaction request         | Archive full transcript before summarizing      |
| `PermissionRequest`  | No         | Yes            | Permission dialog would be displayed    | Custom permission handling                      |
| `SessionStart`       | No         | Yes            | Session initialization                  | Initialize logging and telemetry                |
| `SessionEnd`         | No         | Yes            | Session termination                     | Clean up temporary resources                    |
| `Notification`       | No         | Yes            | Agent status messages                   | Send agent status updates to Slack or PagerDuty |

## Common use cases

Hooks are flexible enough to handle many different scenarios. Here are some of the most common patterns organized by category.

**Security**

- Block dangerous commands (like `rm -rf /`, destructive SQL)
- Validate file paths before write operations
- Enforce allowlists/blocklists for tool usage

**Logging**

- Create audit trails of all agent actions
- Track execution metrics and performance
- Debug agent behavior in development

**Tool interception**

- Redirect file operations to sandboxed directories
- Inject environment variables or credentials
- Transform tool inputs or outputs

**Authorization**

- Implement role-based access control
- Require human approval for sensitive operations
- Rate limit specific tool usage

## Configure hooks

To configure a hook for your agent, pass the hook in the `options.hooks` parameter when calling `query()`:

```typescript
for await (const message of query({
  prompt: "Your prompt",
  options: {
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [myCallback] }],
    },
  },
})) {
  console.log(message);
}
```

The `hooks` option is a dictionary (Python) or object (TypeScript) where:

- **Keys** are [hook event names](#available-hooks) (e.g., `'PreToolUse'`, `'PostToolUse'`, `'Stop'`)
- **Values** are arrays of [matchers](#matchers), each containing an optional filter pattern and your [callback functions](#callback-function-inputs)

Your hook callback functions receive [input data](#input-data) about the event and return a [response](#callback-outputs) so the agent knows to allow, block, or modify the operation.

### Matchers

Use matchers to filter which tools trigger your callbacks:

| Option    | Type             | Default     | Description                                                                                                                                                                                     |
| --------- | ---------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matcher` | `string`         | `undefined` | Regex pattern to match tool names. Built-in tools include `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `Task`, and others. MCP tools use the pattern `mcp__<server>__<action>`. |
| `hooks`   | `HookCallback[]` | -           | Required. Array of callback functions to execute when the pattern matches                                                                                                                       |
| `timeout` | `number`         | `60`        | Timeout in seconds; increase for hooks that make external API calls                                                                                                                             |

Use the `matcher` pattern to target specific tools whenever possible. A matcher with `'Bash'` only runs for Bash commands, while omitting the pattern runs your callbacks for every tool call. Note that matchers only filter by **tool name**, not by file paths or other arguments--to filter by file path, check `tool_input.file_path` inside your callback.

Matchers only apply to tool-based hooks (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`). For lifecycle hooks like `Stop`, `SessionStart`, and `Notification`, matchers are ignored and the hook fires for all events of that type.

> **Tip:** **Discovering tool names:** Check the `tools` array in the initial system message when your session starts, or add a hook without a matcher to log all tool calls.
>
> **MCP tool naming:** MCP tools always start with `mcp__` followed by the server name and action: `mcp__<server>__<action>`. For example, if you configure a server named `playwright`, its tools will be named `mcp__playwright__browser_screenshot`, `mcp__playwright__browser_click`, etc. The server name comes from the key you use in the `mcpServers` configuration.

This example uses a matcher to run a hook only for file-modifying tools when the `PreToolUse` event fires:

```typescript
const options = {
  hooks: {
    PreToolUse: [{ matcher: "Write|Edit", hooks: [validateFilePath] }],
  },
};
```

### Callback function inputs

Every hook callback receives three arguments:

1. **Input data** (`dict` / `HookInput`): Event details. See [input data](#input-data) for fields
2. **Tool use ID** (`str | None` / `string | null`): Correlate `PreToolUse` and `PostToolUse` events
3. **Context** (`HookContext`): In TypeScript, contains a `signal` property (`AbortSignal`) for cancellation. Pass this to async operations like `fetch()` so they automatically cancel if the hook times out. In Python, this argument is reserved for future use.

### Input data

The first argument to your hook callback contains information about the event. Field names are identical across SDKs (both use snake_case).

**Common fields** present in all hook types:

| Field             | Type     | Description                                       |
| ----------------- | -------- | ------------------------------------------------- |
| `hook_event_name` | `string` | The hook type (`PreToolUse`, `PostToolUse`, etc.) |
| `session_id`      | `string` | Current session identifier                        |
| `transcript_path` | `string` | Path to the conversation transcript               |
| `cwd`             | `string` | Current working directory                         |

**Hook-specific fields** vary by hook type. Items marked <sup>TS</sup> are only available in the TypeScript SDK:

| Field                    | Type      | Description                                                                                              | Hooks                                                                                    |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `tool_name`              | `string`  | Name of the tool being called                                                                            | PreToolUse, PostToolUse, PostToolUseFailure<sup>TS</sup>, PermissionRequest<sup>TS</sup> |
| `tool_input`             | `object`  | Arguments passed to the tool                                                                             | PreToolUse, PostToolUse, PostToolUseFailure<sup>TS</sup>, PermissionRequest<sup>TS</sup> |
| `tool_response`          | `any`     | Result returned from tool execution                                                                      | PostToolUse                                                                              |
| `error`                  | `string`  | Error message from tool execution failure                                                                | PostToolUseFailure<sup>TS</sup>                                                          |
| `is_interrupt`           | `boolean` | Whether the failure was caused by an interrupt                                                           | PostToolUseFailure<sup>TS</sup>                                                          |
| `prompt`                 | `string`  | The user's prompt text                                                                                   | UserPromptSubmit                                                                         |
| `stop_hook_active`       | `boolean` | Whether a stop hook is currently processing                                                              | Stop, SubagentStop                                                                       |
| `agent_id`               | `string`  | Unique identifier for the subagent                                                                       | SubagentStart<sup>TS</sup>, SubagentStop<sup>TS</sup>                                    |
| `agent_type`             | `string`  | Type/role of the subagent                                                                                | SubagentStart<sup>TS</sup>                                                               |
| `agent_transcript_path`  | `string`  | Path to the subagent's conversation transcript                                                           | SubagentStop<sup>TS</sup>                                                                |
| `trigger`                | `string`  | What triggered compaction: `manual` or `auto`                                                            | PreCompact                                                                               |
| `custom_instructions`    | `string`  | Custom instructions provided for compaction                                                              | PreCompact                                                                               |
| `permission_suggestions` | `array`   | Suggested permission updates for the tool                                                                | PermissionRequest<sup>TS</sup>                                                           |
| `source`                 | `string`  | How the session started: `startup`, `resume`, `clear`, or `compact`                                      | SessionStart<sup>TS</sup>                                                                |
| `reason`                 | `string`  | Why the session ended: `clear`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, or `other` | SessionEnd<sup>TS</sup>                                                                  |
| `message`                | `string`  | Status message from the agent                                                                            | Notification<sup>TS</sup>                                                                |
| `notification_type`      | `string`  | Type of notification: `permission_prompt`, `idle_prompt`, `auth_success`, or `elicitation_dialog`        | Notification<sup>TS</sup>                                                                |
| `title`                  | `string`  | Optional title set by the agent                                                                          | Notification<sup>TS</sup>                                                                |

The code below defines a hook callback that uses `tool_name` and `tool_input` to log details about each tool call:

```typescript
const logToolCalls: HookCallback = async (input, toolUseID, { signal }) => {
  if (input.hook_event_name === "PreToolUse") {
    const preInput = input as PreToolUseHookInput;
    console.log(`Tool: ${preInput.tool_name}`);
    console.log(`Input:`, preInput.tool_input);
  }
  return {};
};
```

### Callback outputs

Your callback function returns an object that tells the SDK how to proceed. Return an empty object `{}` to allow the operation without changes. To block, modify, or add context to the operation, return an object with a `hookSpecificOutput` field containing your decision.

**Top-level fields** (outside `hookSpecificOutput`):

| Field            | Type      | Description                                                         |
| ---------------- | --------- | ------------------------------------------------------------------- |
| `continue`       | `boolean` | Whether the agent should continue after this hook (default: `true`) |
| `stopReason`     | `string`  | Message shown when `continue` is `false`                            |
| `suppressOutput` | `boolean` | Hide stdout from the transcript (default: `false`)                  |
| `systemMessage`  | `string`  | Message injected into the conversation for Claude to see            |

**Fields inside `hookSpecificOutput`**:

| Field                      | Type                             | Hooks                                                                                            | Description                                                      |
| -------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `hookEventName`            | `string`                         | All                                                                                              | Required. Use `input.hook_event_name` to match the current event |
| `permissionDecision`       | `'allow'` \| `'deny'` \| `'ask'` | PreToolUse                                                                                       | Controls whether the tool executes                               |
| `permissionDecisionReason` | `string`                         | PreToolUse                                                                                       | Explanation shown to Claude for the decision                     |
| `updatedInput`             | `object`                         | PreToolUse                                                                                       | Modified tool input (requires `permissionDecision: 'allow'`)     |
| `additionalContext`        | `string`                         | PreToolUse, PostToolUse, UserPromptSubmit, SessionStart<sup>TS</sup>, SubagentStart<sup>TS</sup> | Context added to the conversation                                |

This example blocks write operations to the `/etc` directory while injecting a system message to remind Claude about safe file practices:

```typescript
const blockEtcWrites: HookCallback = async (input, toolUseID, { signal }) => {
  const filePath = (input as PreToolUseHookInput).tool_input
    ?.file_path as string;

  if (filePath?.startsWith("/etc")) {
    return {
      // Top-level field: inject guidance into the conversation
      systemMessage: "Remember: system directories like /etc are protected.",
      // hookSpecificOutput: block the operation
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: "deny",
        permissionDecisionReason: "Writing to /etc is not allowed",
      },
    };
  }
  return {};
};
```

#### Permission decision flow

When multiple hooks or permission rules apply, the SDK evaluates them in this order:

1. **Deny** rules are checked first (any match = immediate denial).
2. **Ask** rules are checked second.
3. **Allow** rules are checked third.
4. **Default to Ask** if nothing matches.

If any hook returns `deny`, the operation is blocked--other hooks returning `allow` won't override it.

#### Block a tool

Return a deny decision to prevent tool execution:

```typescript
const blockDangerousCommands: HookCallback = async (
  input,
  toolUseID,
  { signal },
) => {
  if (input.hook_event_name !== "PreToolUse") return {};

  const command = (input as PreToolUseHookInput).tool_input.command as string;

  if (command?.includes("rm -rf /")) {
    return {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: "deny",
        permissionDecisionReason: "Dangerous command blocked: rm -rf /",
      },
    };
  }
  return {};
};
```

#### Modify tool input

Return updated input to change what the tool receives:

```typescript
const redirectToSandbox: HookCallback = async (
  input,
  toolUseID,
  { signal },
) => {
  if (input.hook_event_name !== "PreToolUse") return {};

  const preInput = input as PreToolUseHookInput;
  if (preInput.tool_name === "Write") {
    const originalPath = preInput.tool_input.file_path as string;
    return {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: "allow",
        updatedInput: {
          ...preInput.tool_input,
          file_path: `/sandbox${originalPath}`,
        },
      },
    };
  }
  return {};
};
```

> **Note:** When using `updatedInput`, you must also include `permissionDecision`. Always return a new object rather than mutating the original `tool_input`.

#### Add a system message

Inject context into the conversation:

```typescript
const addSecurityReminder: HookCallback = async (
  input,
  toolUseID,
  { signal },
) => {
  return {
    systemMessage: "Remember to follow security best practices.",
  };
};
```

#### Auto-approve specific tools

Bypass permission prompts for trusted tools. This is useful when you want certain operations to run without user confirmation:

```typescript
const autoApproveReadOnly: HookCallback = async (
  input,
  toolUseID,
  { signal },
) => {
  if (input.hook_event_name !== "PreToolUse") return {};

  const preInput = input as PreToolUseHookInput;
  const readOnlyTools = ["Read", "Glob", "Grep", "LS"];
  if (readOnlyTools.includes(preInput.tool_name)) {
    return {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: "allow",
        permissionDecisionReason: "Read-only tool auto-approved",
      },
    };
  }
  return {};
};
```

> **Note:** The `permissionDecision` field accepts three values: `'allow'` (auto-approve), `'deny'` (block), or `'ask'` (prompt for confirmation).

## Handle advanced scenarios

These patterns help you build more sophisticated hook systems for complex use cases.

### Chaining multiple hooks

Hooks execute in the order they appear in the array. Keep each hook focused on a single responsibility and chain multiple hooks for complex logic. This example runs all four hooks for every tool call (no matcher specified):

```typescript
const options = {
  hooks: {
    PreToolUse: [
      { hooks: [rateLimiter] }, // First: check rate limits
      { hooks: [authorizationCheck] }, // Second: verify permissions
      { hooks: [inputSanitizer] }, // Third: sanitize inputs
      { hooks: [auditLogger] }, // Last: log the action
    ],
  },
};
```

### Tool-specific matchers with regex

Use regex patterns to match multiple tools:

```typescript
const options = {
  hooks: {
    PreToolUse: [
      // Match file modification tools
      { matcher: "Write|Edit|Delete", hooks: [fileSecurityHook] },

      // Match all MCP tools
      { matcher: "^mcp__", hooks: [mcpAuditHook] },

      // Match everything (no matcher)
      { hooks: [globalLogger] },
    ],
  },
};
```

> **Note:** Matchers only match **tool names**, not file paths or other arguments. To filter by file path, check `tool_input.file_path` inside your hook callback.

### Tracking subagent activity

Use `SubagentStop` hooks to monitor subagent completion. The `tool_use_id` helps correlate parent agent calls with their subagents:

```typescript
const subagentTracker: HookCallback = async (input, toolUseID, { signal }) => {
  if (input.hook_event_name === "SubagentStop") {
    console.log(`[SUBAGENT] Completed`);
    console.log(`  Tool use ID: ${toolUseID}`);
    console.log(`  Stop hook active: ${input.stop_hook_active}`);
  }
  return {};
};

const options = {
  hooks: {
    SubagentStop: [{ hooks: [subagentTracker] }],
  },
};
```

### Async operations in hooks

Hooks can perform async operations like HTTP requests. Handle errors gracefully by catching exceptions instead of throwing them. In TypeScript, pass the `signal` to `fetch()` so the request cancels if the hook times out:

```typescript
const webhookNotifier: HookCallback = async (input, toolUseID, { signal }) => {
  if (input.hook_event_name !== "PostToolUse") return {};

  try {
    // Pass signal for proper cancellation
    await fetch("https://api.example.com/webhook", {
      method: "POST",
      body: JSON.stringify({
        tool: (input as PostToolUseHookInput).tool_name,
        timestamp: new Date().toISOString(),
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.log("Webhook request cancelled");
    }
  }

  return {};
};
```

### Sending notifications (TypeScript only)

Use `Notification` hooks to receive status updates from the agent and forward them to external services like Slack or monitoring dashboards:

```typescript
import {
  query,
  HookCallback,
  NotificationHookInput,
} from "@anthropic-ai/claude-agent-sdk";

const notificationHandler: HookCallback = async (
  input,
  toolUseID,
  { signal },
) => {
  const notification = input as NotificationHookInput;

  await fetch("https://hooks.slack.com/services/YOUR/WEBHOOK/URL", {
    method: "POST",
    body: JSON.stringify({
      text: `Agent status: ${notification.message}`,
    }),
    signal,
  });

  return {};
};

for await (const message of query({
  prompt: "Analyze this codebase",
  options: {
    hooks: {
      Notification: [{ hooks: [notificationHandler] }],
    },
  },
})) {
  console.log(message);
}
```

## Fix common issues

This section covers common issues and how to resolve them.

### Hook not firing

- Verify the hook event name is correct and case-sensitive (`PreToolUse`, not `preToolUse`)
- Check that your matcher pattern matches the tool name exactly
- Ensure the hook is under the correct event type in `options.hooks`
- For `SubagentStop`, `Stop`, `SessionStart`, `SessionEnd`, and `Notification` hooks, matchers are ignored. These hooks fire for all events of that type.
- Hooks may not fire when the agent hits the [`max_turns`](/docs/en/agent-sdk/python#configuration-options) limit because the session ends before hooks can execute

### Matcher not filtering as expected

Matchers only match **tool names**, not file paths or other arguments. To filter by file path, check `tool_input.file_path` inside your hook:

```typescript
const myHook: HookCallback = async (input, toolUseID, { signal }) => {
  const preInput = input as PreToolUseHookInput;
  const filePath = preInput.tool_input?.file_path as string;
  if (!filePath?.endsWith(".md")) return {}; // Skip non-markdown files
  // Process markdown files...
};
```

### Hook timeout

- Increase the `timeout` value in the `HookMatcher` configuration
- Use the `AbortSignal` from the third callback argument to handle cancellation gracefully in TypeScript

### Tool blocked unexpectedly

- Check all `PreToolUse` hooks for `permissionDecision: 'deny'` returns
- Add logging to your hooks to see what `permissionDecisionReason` they're returning
- Verify matcher patterns aren't too broad (an empty matcher matches all tools)

### Modified input not applied

- Ensure `updatedInput` is inside `hookSpecificOutput`, not at the top level:

  ```typescript
  return {
    hookSpecificOutput: {
      hookEventName: input.hook_event_name,
      permissionDecision: "allow",
      updatedInput: { command: "new command" },
    },
  };
  ```

- You must also return `permissionDecision: 'allow'` for the input modification to take effect
- Include `hookEventName` in `hookSpecificOutput` to identify which hook type the output is for

### Session hooks not available

`SessionStart`, `SessionEnd`, and `Notification` hooks are only available in the TypeScript SDK. The Python SDK does not support these events due to setup limitations.

### Subagent permission prompts multiplying

When spawning multiple subagents, each one may request permissions separately. Subagents do not automatically inherit parent agent permissions. To avoid repeated prompts, use `PreToolUse` hooks to auto-approve specific tools, or configure permission rules that apply to subagent sessions.

### Recursive hook loops with subagents

A `UserPromptSubmit` hook that spawns subagents can create infinite loops if those subagents trigger the same hook. To prevent this:

- Check for a subagent indicator in the hook input before spawning
- Use the `parent_tool_use_id` field to detect if you're already in a subagent context
- Scope hooks to only run for the top-level agent session

### systemMessage not appearing in output

The `systemMessage` field adds context to the conversation that the model sees, but it may not appear in all SDK output modes. If you need to surface hook decisions to your application, log them separately or use a dedicated output channel.

## Learn more

- [Permissions](/docs/en/agent-sdk/permissions): control what your agent can do
- [Custom Tools](/docs/en/agent-sdk/custom-tools): build tools to extend agent capabilities
- [TypeScript SDK Reference](/docs/en/agent-sdk/typescript)
- [Python SDK Reference](/docs/en/agent-sdk/python)
