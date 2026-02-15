import { apiClient } from "@/services/apiClient";
import type { DiscardedItem } from "@/types/domain";

export function getDiscarded(): Promise<{ items: DiscardedItem[] }> {
  return apiClient.get<{ items: DiscardedItem[] }>("/api/discarded");
}

export function restoreDiscarded(id: number): Promise<{ ok: boolean; content: string }> {
  return apiClient.post<{ ok: boolean; content: string }>("/api/discarded/restore", { id });
}

export function deleteDiscarded(id: number): Promise<{ ok: boolean }> {
  return apiClient.delete<{ ok: boolean }>(`/api/discarded/${id}`);
}
