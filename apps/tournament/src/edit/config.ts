import { z } from "zod";
import type { EditConfig, NetworkPolicy, SettingSource } from "./types.js";

export const DEFAULT_TOOL_ALLOWLIST = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
];

export const NetworkPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    allowlist: z.array(z.string()).default([]),
  })
  .default({ enabled: false, allowlist: [] });

export const SettingSourceSchema = z.enum(["user", "project", "local"]);

export const EditConfigSchema = z.object({
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

export type { EditConfig, NetworkPolicy, SettingSource };
