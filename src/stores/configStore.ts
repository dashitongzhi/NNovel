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

function mergeConfig(prev: AppConfig, payload: Partial<AppConfig>): AppConfig {
  const next: AppConfig = { ...DEFAULT_CONFIG, ...prev, ...payload };
  AUTH_FIELDS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      next[key] = prev[key];
    }
  });
  return next;
}

interface ConfigState {
  config: AppConfig;
  loading: boolean;
  saving: boolean;
  load: () => Promise<void>;
  save: () => Promise<void>;
  patch: (patch: Partial<AppConfig>) => void;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: DEFAULT_CONFIG,
  loading: false,
  saving: false,
  load: async () => {
    set({ loading: true });
    try {
      const payload = await getConfig();
      set((state) => ({ config: mergeConfig(state.config, payload) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载配置失败";
      useUiStore.getState().addToast(`加载配置失败: ${message}`, "error");
    } finally {
      set({ loading: false });
    }
  },
  save: async () => {
    const { config } = get();
    set({ saving: true });
    try {
      const payload = await saveConfig(config);
      set((state) => ({ config: mergeConfig(state.config, payload) }));
      useUiStore.getState().addToast("配置已保存", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存配置失败";
      useUiStore.getState().addToast(`保存配置失败: ${message}`, "error");
    } finally {
      set({ saving: false });
    }
  },
  patch: (patch) => set((state) => ({ config: { ...state.config, ...patch } })),
}));
