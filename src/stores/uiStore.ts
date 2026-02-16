import { create } from "zustand";
import type { LiquidProfile } from "@/config/liquidGlassPresets";

export type ToastType = "success" | "warning" | "error" | "info";
export type ThemeMode = "light" | "dark" | "auto";

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

export interface InfoBoxItem {
  id: number;
  message: string;
  createdAt: number;
}

interface UiState {
  theme: ThemeMode;
  dynamicEffectsEnabled: boolean;
  liquidProfile: LiquidProfile;
  toasts: ToastItem[];
  infoItems: InfoBoxItem[];
  sidebarCollapsed: boolean;
  addInfo: (message: string) => void;
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: number) => void;
  clearInfoItems: () => void;
  removeInfoItem: (id: number) => void;
  setTheme: (theme: ThemeMode) => void;
  setDynamicEffectsEnabled: (enabled: boolean) => void;
  setLiquidProfile: (profile: LiquidProfile) => void;
  syncTheme: () => void;
  toggleSidebar: () => void;
}

let nextToastId = 1;
const THEME_KEY = "theme";
const DYNAMIC_EFFECTS_KEY = "writer:dynamicEffectsEnabled";
const LIQUID_PROFILE_KEY = "writer:liquidProfile";

function readThemeMode(): ThemeMode {
  const raw = String(localStorage.getItem(THEME_KEY) || "auto").trim().toLowerCase();
  if (raw === "light" || raw === "dark" || raw === "auto") return raw;
  return "auto";
}

function readDynamicEffectsEnabled(): boolean {
  const raw = localStorage.getItem(DYNAMIC_EFFECTS_KEY);
  if (raw == null) return true;
  return raw === "true";
}

function readLiquidProfile(): LiquidProfile {
  const raw = String(localStorage.getItem(LIQUID_PROFILE_KEY) || "aggressive").trim().toLowerCase();
  if (raw === "balanced" || raw === "aggressive" || raw === "experimental") return raw;
  return "aggressive";
}

function resolvedTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

function applyTheme(mode: ThemeMode): void {
  const applied = resolvedTheme(mode);
  if (applied === "dark") {
    document.body.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.body.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme");
  }
}

export const useUiStore = create<UiState>((set) => ({
  theme: readThemeMode(),
  dynamicEffectsEnabled: readDynamicEffectsEnabled(),
  liquidProfile: readLiquidProfile(),
  toasts: [],
  infoItems: [],
  sidebarCollapsed: false,
  addInfo: (message) => {
    const id = nextToastId++;
    set((state) => ({
      infoItems: [...state.infoItems, { id, message, createdAt: Date.now() }],
    }));
  },
  addToast: (message, type = "success") => {
    const id = nextToastId++;
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }],
      ...(type === "error"
        ? { infoItems: [...state.infoItems, { id, message, createdAt: Date.now() }] }
        : {}),
    }));
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((x) => x.id !== id) }));
    }, 3200);
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((x) => x.id !== id) })),
  clearInfoItems: () => set({ infoItems: [] }),
  removeInfoItem: (id) => set((state) => ({ infoItems: state.infoItems.filter((x) => x.id !== id) })),
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  setDynamicEffectsEnabled: (enabled) => {
    localStorage.setItem(DYNAMIC_EFFECTS_KEY, String(enabled));
    set({ dynamicEffectsEnabled: enabled });
  },
  setLiquidProfile: (profile) => {
    localStorage.setItem(LIQUID_PROFILE_KEY, profile);
    set({ liquidProfile: profile });
  },
  syncTheme: () => {
    const mode = useUiStore.getState().theme;
    applyTheme(mode);
  },
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
