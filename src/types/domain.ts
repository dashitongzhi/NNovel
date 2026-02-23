export type EngineMode = "codex" | "gemini" | "claude" | "doubao" | "personal";

export interface AppConfig {
  config_version: number;
  outline: string;
  reference: string;
  requirements: string;
  word_target: string;
  extra_settings: string;
  global_memory: string;
  global_memory_structured?: Record<string, unknown>;
  engine_mode: EngineMode;
  codex_model: string;
  gemini_model: string;
  claude_model: string;
  codex_access_mode: "cli" | "api";
  gemini_access_mode: "cli" | "api";
  claude_access_mode: "cli" | "api";
  codex_api_key: string;
  gemini_api_key: string;
  claude_api_key: string;
  codex_reasoning_effort: "low" | "medium" | "high";
  gemini_reasoning_effort: "low" | "medium" | "high";
  claude_reasoning_effort: "low" | "medium" | "high";
  doubao_reasoning_effort: "low" | "medium" | "high";
  doubao_models: string;
  doubao_model: string;
  personal_base_url: string;
  personal_api_key: string;
  personal_models: string;
  personal_model: string;
  proxy_port: string;
  cache: string;
  books?: Array<{
    id: string;
    title: string;
    folder?: string;
    updated_at?: string;
    chapter_count?: number | string;
    total_chapters?: number | string;
  }>;
  active_book?: { id: string; title: string; folder?: string };
  book_paths?: Record<string, string>;
  first_run_required?: boolean;
  settings_path?: string;
  auth_path?: string;
}

export interface ProviderConfig {
  base_url: string;
  api_key: string;
  model: string;
  reasoning: "low" | "medium" | "high";
}

export interface StoragePort {
  loadConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<AppConfig>;
  loadDraft: () => Promise<string>;
  saveDraft: (content: string) => Promise<void>;
}

export type GenerationTaskState =
  | "idle"
  | "queued"
  | "generating"
  | "finishing"
  | "completed"
  | "paused"
  | "error"
  | "stopped";

export interface GenerationStatusResponse {
  state: "running" | "done" | "error" | "stopped" | "stopping" | "paused";
  partial_content?: string;
  content?: string;
  thinking?: string;
  message?: string;
  error_code?: string;
  request_id?: string;
}

export interface DiscardedItem {
  id: number;
  content: string;
  created_at?: string;
  char_count?: number;
}

export interface ConsistencyConflict {
  type?: string;
  issue?: string;
  evidence?: string;
  suggestion?: string;
}

export interface ChapterSaveResponse {
  ok?: boolean;
  global_memory?: string;
  memory_updated?: boolean;
  memory_error?: string;
  consistency_checked?: boolean;
  consistency_has_conflicts?: boolean;
  consistency_summary?: string;
  consistency_error?: string;
  consistency_conflicts?: ConsistencyConflict[];
}

export interface BookshelfPayload {
  books: Array<{
    id: string;
    title: string;
    folder?: string;
    updated_at?: string;
    chapter_count?: number | string;
    total_chapters?: number | string;
  }>;
  active_book?: { id: string; title: string; folder?: string };
  active_book_id?: string;
  active_paths?: Record<string, string>;
}

export interface ModelHealthRow {
  engine: string;
  model: string;
  recent_n: number;
  success_n: number;
  success_rate: number;
  avg_first_token_ms: number;
  avg_total_ms: number;
  cooldown_ms: number;
}

export interface StartupStatus {
  engine_mode?: string;
  codex_model?: string;
  gemini_model?: string;
  claude_model?: string;
  doubao_model?: string;
  personal_model?: string;
  runtime_last_model?: string;
  codex_access_mode?: "cli" | "api";
  gemini_access_mode?: "cli" | "api";
  claude_access_mode?: "cli" | "api";
  codex_available?: boolean;
  gemini_available?: boolean;
  claude_available?: boolean;
  codex_api_ready?: boolean;
  gemini_api_ready?: boolean;
  claude_api_ready?: boolean;
  doubao_ready?: boolean;
  personal_ready?: boolean;
  message?: string;
  active_book?: { id: string; title: string };
  model_health?: ModelHealthRow[];
  runtime_last_error?: string;
  runtime_last_error_code?: string;
  [key: string]: unknown;
}

export interface SelfCheckItem {
  id?: string;
  name?: string;
  label?: string;
  ok: boolean;
  detail?: string;
}

export interface SelfCheckResponse {
  ok?: boolean;
  summary?: string;
  checks: SelfCheckItem[];
  required_ids?: string[];
}

export interface SettingsFilePayload {
  path: string;
  backup_path?: string;
  content: string;
}

export interface OutlineGeneratePayload extends Partial<AppConfig> {
  outline: string;
}

export interface InfoBoxItem {
  id: number;
  message: string;
  createdAt: number;
}
