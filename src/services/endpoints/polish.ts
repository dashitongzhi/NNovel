import { apiClient } from "@/services/apiClient";
import type { AppConfig } from "@/types/domain";

export interface DraftPolishPayload extends Partial<AppConfig> {
  content: string;
  polish_requirements?: string;
}

export interface DraftPolishResponse {
  ok: boolean;
  content: string;
  engine_mode?: string;
  model?: string;
}

export function polishDraft(payload: DraftPolishPayload): Promise<DraftPolishResponse> {
  return apiClient.post<DraftPolishResponse>("/api/draft/polish", payload);
}

