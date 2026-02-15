import { apiClient } from "@/services/apiClient";

export function getDraft(): Promise<{ content: string }> {
  return apiClient.get<{ content: string }>("/api/draft");
}

export function saveDraft(content: string): Promise<{ ok: boolean; cache?: string; content?: string }> {
  return apiClient.post<{ ok: boolean; cache?: string; content?: string }>("/api/draft/save", { content });
}

export function acceptDraft(content: string): Promise<{ draft_content: string }> {
  return apiClient.post<{ draft_content: string }>("/api/draft/accept", { content });
}

export function deleteDraft(content: string): Promise<{ ok: boolean; discarded_added?: boolean }> {
  return apiClient.post<{ ok: boolean; discarded_added?: boolean }>("/api/draft/delete", { content });
}
