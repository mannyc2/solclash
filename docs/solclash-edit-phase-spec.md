SolClash Edit Phase + Orchestration Spec (v1)

1. Scope
   This spec defines the edit-phase harness and container orchestration for SolClash
   tournaments. It is intentionally focused on the orchestration contract and the
   edit-phase harness requirements. Arena rules, accounting, and policy ABI are
   defined in other specs.

References:

- Core rules: docs/solclash-core-spec.md
- Tournament runner (local): docs/solclash-tournament.md
- Logs + metadata: docs/solclash-data-ops.md

2. Roles and Containers
   The system runs two distinct container roles:

- Agent container: one per agent, used during the edit phase only.
- Arena container: a single game container used during competition.

Isolation requirements:

- Each agent runs in its own container during the edit phase.
- The arena runs in a separate container during competition.
- Agent containers are not reused as the arena container.

3. Round Lifecycle (Two-Phase Loop)
   Each round proceeds in two phases:

1) Edit phase: each agent modifies its codebase within a fixed turn budget.
2) Competition phase: the arena executes all agents on identical windows and
   computes scores.

Before competition begins:

- Each agent codebase is copied into the arena container under `/{agent_name}`.

4. Edit Phase Harness (Abstracted Interface)
   The edit phase uses an abstract harness interface to run each agent session
   against its codebase in an isolated container. The initial implementation is
   planned with the Claude Agent SDK, but the harness must remain provider-agnostic
   to allow alternative agent runtimes in the future.

4.1 Harness Interface (Provider-Agnostic)
The orchestration layer interacts with the harness via a narrow interface.

Inputs:

- agent_id: stable identifier for the agent (used for logs + results).
- workspace_path: absolute path to the agent codebase root (container-local).
- system_prompt: fixed per tournament; must be deterministic across agents.
- max_turns: edit-phase turn budget (default 30).
- tool_allowlist: Read/Write/Edit/Glob/Grep/Bash.
- sandbox_enabled: boolean (default true).
- network_policy: { enabled: boolean, allowlist?: string[] }.
- settings_sources: list of filesystem settings sources (default empty).

Outputs:

- updated workspace at workspace_path (edits applied in-place).
- edit logs / traces (format is harness-specific but must be emitted).
- exit status indicating success, timeout, or failure.

Error handling:

- If the harness fails, the agent's workspace remains as-is for the round.
- The failure reason is recorded in edit-phase logs and reported to the
  tournament controller.

Required harness settings (provider-agnostic):

- Working directory: repo root.
- Tooling: Read/Write/Edit/Glob/Grep/Bash.
- Permissions: non-interactive (no human approvals during tournament).
- Sandbox: enabled for all Bash commands.
- Network: disabled by default; if enabled, must use an explicit allowlist.
- Session settings must be deterministic across agents within a tournament.

v1 defaults (can be tuned):

- permissionMode: acceptEdits
- sandbox.enabled: true
- sandbox.autoAllowBashIfSandboxed: true
- settingSources: [] (no filesystem settings)
- maxTurns: 30 per edit phase

5. Submission Validation
   Before competition, each agent submission is validated:

- Run `cargo build-sbf` in `program/`.
- Verify `program/target/deploy/solclash_policy.so` exists.
- If validation fails or the artifact is missing, the submission is invalid and
  receives a round score of 0.

6. Competition Execution Contract
   Each round executes the following steps:

1) validate_code(agent)
2) execute_round(valid_agents)
3) get_results(valid_agents)

The arena must produce:

- Per-round results file
- Logs for all valid agents

See docs/solclash-core-spec.md for program execution details and the arena
microstructure rules.

7. Log Injection
   After competition:

- The arena writes logs to host under `logs/rounds/{round_num}/`.
- The entire round log folder is copied into each agent container at
  `logs/rounds/{round_num}/` before the next edit phase begins.

8. Metadata and Artifacts
   Per-round:

- The arena must write `round_meta.json` containing:
  - winner
  - scores by agent
  - invalid_agents (map of agent_id -> reason)
  - round timestamps

Tournament-level:

- Metadata must include:
  - arena config
  - list of agents
  - per-round results

See docs/solclash-data-ops.md for the logging schema.

9. Determinism and Safety

- Session settings are fixed and deterministic across agents within a tournament.
- Network is disabled by default to avoid non-deterministic dependencies.
- Sandbox is enabled for all Bash commands.

10. Out of Scope

- Policy ABI details, simulation accounting, and scoring weights.
- Model selection, prompting content, or API keys for any specific harness provider.
- Container implementation details (image contents, build steps).

11. Implementation Notes (Non-Normative)

- Some harness providers auto-inject tool descriptions into the system prompt.
  Orchestrators should avoid duplicating tool docs in the prompt when the
  provider already supplies them (e.g., Claude Agent SDK).

  11.1 Claude Agent SDK Mapping (Non-Normative)
  If using the Claude Agent SDK as the harness provider, the following options
  map the spec requirements to SDK settings:

- systemPrompt: fixed, deterministic prompt (do not embed tool docs)
- cwd: workspace_path (repo root)
- maxTurns: 30 (or configured value)
- permissionMode: "acceptEdits" (non-interactive)
- tools/allowedTools: restrict to Read/Write/Edit/Glob/Grep/Bash
- sandbox: { enabled: true, autoAllowBashIfSandboxed: true }
- settingSources: [] (no filesystem settings or CLAUDE.md)
- network: disabled by default (exclude WebFetch/WebSearch; only allow with explicit allowlist)
  - If network is enabled, enforce the allowlist via PreToolUse hooks for WebFetch.
  - Container-level network isolation is optional; tool-level allowlisting is sufficient for v1.
