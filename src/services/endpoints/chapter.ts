import { apiClient } from "@/services/apiClient";
import type { ChapterSaveResponse } from "@/types/domain";

export function generateChapterTitle(content: string): Promise<{ ok: boolean; title: string }> {
  return apiClient.post<{ ok: boolean; title: string }>("/api/chapter/generate-title", { content });
}

export function saveChapter(content: string, title: string): Promise<ChapterSaveResponse> {
  return apiClient.post<ChapterSaveResponse>("/api/chapter/save", { content, title });
}
