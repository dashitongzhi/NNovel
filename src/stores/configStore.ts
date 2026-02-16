import { create } from "zustand";
import { DEFAULT_CONFIG } from "@/config/defaults";
import { getConfig, saveConfig } from "@/services/endpoints/config";
import type { AppConfig } from "@/types/domain";
import { useUiStore } from "@/stores/uiStore";

type AuthField = "codex_api_key" | "gemini_api_key" | "claude_api_key" | "personal_api_key" | "personal_base_url";

const AUTH_FIELDS: AuthField[] = [
  "codex_api_key",
  "gemini_api_key",
  "claude_api_key",
  "personal_api_key",
  "personal_base_url",
];

let configDebugSeq = 0;

function previewModelRows(text: string): string[] {
  return String(text || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function pickDebugView(config: AppConfig): Record<string, unknown> {
  return {
    engine_mode: config.engine_mode,
    doubao_model: config.doubao_model,
    doubao_models_head: previewModelRows(config.doubao_models),
    personal_model: config.personal_model,
    personal_models_head: previewModelRows(config.personal_models),
  };
}

function shouldLogPatch(patch: Partial<AppConfig>): boolean {
  const keys = Object.keys(patch);
  return keys.some((key) => (
    key === "engine_mode"
    || key === "doubao_model"
    || key === "doubao_models"
    || key === "doubao_reasoning_effort"
    || key === "personal_model"
    || key === "personal_models"
  ));
}

function logConfigDebug(tag: string, payload: Record<string, unknown>): void {
  configDebugSeq += 1;
  const line = `[debug][configStore:${configDebugSeq}] ${tag} ${JSON.stringify(payload)}`;
  console.log(line);
}

function mergeConfig(prev: AppConfig, payload: Partial<AppConfig>): AppConfig {
  const next: AppConfig = { ...DEFAULT_CONFIG, ...prev, ...payload };
  AUTH_FIELDS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      next[key] = prev[key];
    }
  });
  return next;
}

function reconcileAfterSave(requestConfig: AppConfig, currentConfig: AppConfig, payload: Partial<AppConfig>): AppConfig {
  const serverMerged = mergeConfig(requestConfig, payload);
  const next: AppConfig = { ...serverMerged };
  (Object.keys(currentConfig) as Array<keyof AppConfig>).forEach((key) => {
    if (currentConfig[key] !== requestConfig[key]) {
      (next as unknown as Record<string, unknown>)[String(key)] = currentConfig[key] as unknown;
    }
  });
  return next;
}

interface ConfigState {
  config: AppConfig;
  loading: boolean;
  saving: boolean;
  load: () => Promise<void>;
  save: (opts?: { silent?: boolean }) => Promise<void>;
  saveQuietly: () => Promise<void>;
  patch: (patch: Partial<AppConfig>) => void;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: DEFAULT_CONFIG,
  loading: false,
  saving: false,
  load: async () => {
    set({ loading: true });
    try {
      logConfigDebug("load:start", {
        before: pickDebugView(get().config),
      });
      const payload = await getConfig();
      set((state) => {
        const next = mergeConfig(state.config, payload);
        logConfigDebug("load:done", {
          server: {
            engine_mode: payload.engine_mode,
            doubao_model: payload.doubao_model,
            doubao_models_head: previewModelRows(String(payload.doubao_models || "")),
            personal_model: payload.personal_model,
            personal_models_head: previewModelRows(String(payload.personal_models || "")),
          },
          after: pickDebugView(next),
        });
        return { config: next };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载配置失败";
      useUiStore.getState().addToast(`加载配置失败: ${message}`, "error");
      logConfigDebug("load:error", { message });
    } finally {
      set({ loading: false });
    }
  },
  save: async (opts) => {
    const requestConfig = get().config;
    set({ saving: true });
    try {
      logConfigDebug("save:start", {
        request: pickDebugView(requestConfig),
        silent: Boolean(opts?.silent),
      });
      const payload = await saveConfig(requestConfig);
      set((state) => {
        const next = reconcileAfterSave(requestConfig, state.config, payload);
        logConfigDebug("save:done", {
          request: pickDebugView(requestConfig),
          server: {
            engine_mode: payload.engine_mode,
            doubao_model: payload.doubao_model,
            doubao_models_head: previewModelRows(String(payload.doubao_models || "")),
            personal_model: payload.personal_model,
            personal_models_head: previewModelRows(String(payload.personal_models || "")),
          },
          current_before_merge: pickDebugView(state.config),
          current_after_merge: pickDebugView(next),
        });
        return { config: next };
      });
      if (!opts?.silent) {
        useUiStore.getState().addToast("配置已保存", "success");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存配置失败";
      useUiStore.getState().addToast(`保存配置失败: ${message}`, "error");
      logConfigDebug("save:error", { message, request: pickDebugView(requestConfig) });
    } finally {
      set({ saving: false });
    }
  },
  saveQuietly: async () => {
    const requestConfig = get().config;
    try {
      logConfigDebug("save_quiet:start", {
        request: pickDebugView(requestConfig),
      });
      const payload = await saveConfig(requestConfig);
      set((state) => {
        const next = reconcileAfterSave(requestConfig, state.config, payload);
        logConfigDebug("save_quiet:done", {
          request: pickDebugView(requestConfig),
          server: {
            engine_mode: payload.engine_mode,
            doubao_model: payload.doubao_model,
            doubao_models_head: previewModelRows(String(payload.doubao_models || "")),
            personal_model: payload.personal_model,
            personal_models_head: previewModelRows(String(payload.personal_models || "")),
          },
          current_before_merge: pickDebugView(state.config),
          current_after_merge: pickDebugView(next),
        });
        return { config: next };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "静默保存配置失败";
      logConfigDebug("save_quiet:error", { message, request: pickDebugView(requestConfig) });
      useUiStore.getState().addToast(`静默保存失败: ${message}`, "error");
    }
  },
  patch: (patch) => set((state) => {
    const next = { ...state.config, ...patch };
    if (shouldLogPatch(patch)) {
      logConfigDebug("patch", {
        patch,
        before: pickDebugView(state.config),
        after: pickDebugView(next),
      });
    }
    return { config: next };
  }),
}));
