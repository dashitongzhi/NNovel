import type { AppConfig } from "@/types/domain";

export const DEFAULT_CONFIG: AppConfig = {
  config_version: 2,
  outline: "",
  reference: "",
  requirements: "",
  extra_settings: "",
  global_memory: "",
  engine_mode: "codex",
  codex_model: "gpt-5.1-codex-mini",
  gemini_model: "gemini-2.5-flash",
  claude_model: "sonnet",
  codex_access_mode: "cli",
  gemini_access_mode: "cli",
  claude_access_mode: "cli",
  codex_api_key: "",
  gemini_api_key: "",
  claude_api_key: "",
  codex_reasoning_effort: "medium",
  gemini_reasoning_effort: "medium",
  claude_reasoning_effort: "medium",
  doubao_reasoning_effort: "medium",
  doubao_models: "doubao-seed-1-6-251015",
  doubao_model: "doubao-seed-1-6-251015",
  personal_base_url: "",
  personal_api_key: "",
  personal_models: "deepseek-ai/deepseek-v3.2",
  personal_model: "deepseek-ai/deepseek-v3.2",
  proxy_port: "10808",
  cache: "",
};

export const ENGINE_LABELS: Record<string, string> = {
  codex: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude",
  doubao: "Doubao",
  personal: "个人配置",
};

export const STAGE_ORDER: Array<"queued" | "generating" | "finishing" | "completed"> = [
  "queued",
  "generating",
  "finishing",
  "completed",
];
