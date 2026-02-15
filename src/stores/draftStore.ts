import { create } from "zustand";
import { acceptDraft, deleteDraft, getDraft, saveDraft } from "@/services/endpoints/draft";
import { useUiStore } from "@/stores/uiStore";

interface DraftState {
  content: string;
  loading: boolean;
  autosaveAt: number;
  load: () => Promise<void>;
  setContent: (content: string) => void;
  saveNow: () => Promise<void>;
  acceptGenerated: (content: string) => Promise<void>;
  deleteGenerated: (content: string) => Promise<boolean>;
}

let autosaveTimer: number | null = null;

function cacheSummary(input: string): string {
  const text = String(input || "").replace(/\r\n/g, "\n").trimEnd();
  if (!text) return "";
  if (text.length <= 350) return text;
  return text.slice(-350);
}

export const useDraftStore = create<DraftState>((set, get) => ({
  content: "",
  loading: false,
  autosaveAt: 0,
  load: async () => {
    set({ loading: true });
    try {
      const payload = await getDraft();
      set({ content: payload.content || "" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载草稿失败";
      useUiStore.getState().addToast(`加载草稿失败: ${message}`, "error");
    } finally {
      set({ loading: false });
    }
  },
  setContent: (content) => {
    set({ content });
    if (autosaveTimer) {
      window.clearTimeout(autosaveTimer);
    }
    autosaveTimer = window.setTimeout(async () => {
      const latest = get().content;
      try {
        await saveDraft(latest);
        set({ autosaveAt: Date.now() });
      } catch {
        useUiStore.getState().addToast("自动保存失败", "warning");
      }
    }, 600);
  },
  saveNow: async () => {
    const content = get().content;
    await saveDraft(content);
    set({ autosaveAt: Date.now() });
  },
  acceptGenerated: async (content) => {
    if (!content.trim()) return;
    try {
      const payload = await acceptDraft(content);
      set({ content: payload.draft_content || get().content });
      useUiStore.getState().addToast("内容已采纳到草稿箱", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "采纳失败";
      useUiStore.getState().addToast(`采纳失败: ${message}`, "error");
    }
  },
  deleteGenerated: async (content) => {
    try {
      const payload = await deleteDraft(content);
      if (payload.discarded_added) {
        useUiStore.getState().addToast("已存入废弃稿件", "success");
      }
      return Boolean(payload.discarded_added);
    } catch (error) {
      const message = error instanceof Error ? error.message : "重写失败";
      useUiStore.getState().addToast(`重写失败: ${message}`, "error");
      return false;
    }
  },
}));

export const draftCacheSummary = cacheSummary;
