/**
 * Edit phase configuration — types + validation.
 *
 * The edit phase config controls how Claude Code sessions run:
 * which tools agents can use, how many turns they get, whether
 * networking is allowed, which Docker image to use, etc.
 *
 * buildEditConfig() is the only entry point — it takes a partial
 * config (from the arena config file's `tournament.edit` section)
 * and fills in defaults via Zod.
 */
import { z } from "zod";

// ── Types ──────────────────────────────────────────────────────────

export type SettingSource = "user" | "project" | "local";

export interface NetworkPolicy {
  enabled: boolean;
  allowlist?: string[];
}

export interface EditSessionInput {
  agent_id: string;
  workspace_path: string;
  system_prompt: string;
  max_turns?: number;
  tool_allowlist?: string[];
  sandbox_enabled?: boolean;
  network_policy?: NetworkPolicy;
  settings_sources?: SettingSource[];
  timeout_ms?: number;
  model?: string;
  provider?: string;
}

export type EditSessionStatus = "success" | "timeout" | "failure";

export interface EditSessionOutput {
  status: EditSessionStatus;
  session_id?: string;
  checkpoint_id?: string;
  error?: string;
  log_dir: string;
}

export interface EditConfig {
  enabled: boolean;
  prompt_ref: string;
  max_turns: number;
  tool_allowlist: string[];
  sandbox_enabled: boolean;
  network_policy: NetworkPolicy;
  settings_sources: SettingSource[];
  timeout_ms?: number;
  concurrency: number;
  model?: string;
  image: string;
  runner_path: string;
}

export interface ResolvedPrompt {
  ref: string;
  path: string | null;
  content: string;
  sha256: string;
}

// ── Schemas (internal to buildEditConfig) ──────────────────────────

const DEFAULT_TOOL_ALLOWLIST = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
];

const NetworkPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    allowlist: z.array(z.string()).default([]),
  })
  .default({ enabled: false, allowlist: [] });

const SettingSourceSchema = z.enum(["user", "project", "local"]);

const EditConfigSchema = z.object({
  enabled: z.boolean().default(true),
  prompt_ref: z.string(),
  max_turns: z.number().int().positive().default(250),
  tool_allowlist: z.array(z.string()).default(DEFAULT_TOOL_ALLOWLIST),
  sandbox_enabled: z.boolean().default(true),
  network_policy: NetworkPolicySchema,
  settings_sources: z.array(SettingSourceSchema).default([]),
  timeout_ms: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().default(4),
  model: z.string().optional(),
  image: z.string().default("solclash-agent"),
  runner_path: z.string().default("/opt/solclash/edit-runner.mjs"),
});

export function buildEditConfig(input: Partial<EditConfig>): EditConfig {
  return EditConfigSchema.parse(input);
}
