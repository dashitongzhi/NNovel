import { create } from "zustand";
import { deleteDiscarded, getDiscarded, restoreDiscarded } from "@/services/endpoints/discarded";
import type { DiscardedItem } from "@/types/domain";
import { useUiStore } from "@/stores/uiStore";

interface DiscardedState {
  items: DiscardedItem[];
  visible: boolean;
  loading: boolean;
  setVisible: (visible: boolean) => void;
  load: () => Promise<void>;
  restore: (id: number) => Promise<string | null>;
  remove: (id: number) => Promise<void>;
}

export const useDiscardedStore = create<DiscardedState>((set, get) => ({
  items: [],
  visible: false,
  loading: false,
  setVisible: (visible) => set({ visible }),
  load: async () => {
    set({ loading: true });
    try {
      const payload = await getDiscarded();
      set({ items: Array.isArray(payload.items) ? payload.items : [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载废弃稿件失败";
      useUiStore.getState().addToast(`加载废弃稿件失败: ${message}`, "error");
    } finally {
      set({ loading: false });
    }
  },
  restore: async (id) => {
    try {
      const payload = await restoreDiscarded(id);
      const restored = payload.content || "";
      set({ items: get().items.filter((x) => x.id !== id) });
      useUiStore.getState().addToast("已复原废弃稿件", "success");
      return restored;
    } catch (error) {
      const message = error instanceof Error ? error.message : "复原失败";
      useUiStore.getState().addToast(`复原失败: ${message}`, "error");
      return null;
    }
  },
  remove: async (id) => {
    try {
      await deleteDiscarded(id);
      set({ items: get().items.filter((x) => x.id !== id) });
      useUiStore.getState().addToast("已删除废弃稿件", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败";
      useUiStore.getState().addToast(`删除失败: ${message}`, "error");
    }
  },
}));
