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
