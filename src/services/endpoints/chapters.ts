import { apiClient } from "@/services/apiClient";

export interface ChapterItem {
  id: number;
  title: string;
  file?: string;
  char_count?: number;
  created_at?: string;
}

export function listChapters(): Promise<ChapterItem[]> {
  return apiClient.get<ChapterItem[]>("/api/chapters");
}

export function getChapter(chapterId: number): Promise<{ id: number; title: string; content: string }> {
  return apiClient.get<{ id: number; title: string; content: string }>(`/api/chapters/${chapterId}`);
}

export function deleteChapter(chapterId: number): Promise<{ ok: boolean }> {
  return apiClient.delete<{ ok: boolean }>(`/api/chapters/${chapterId}`);
}
