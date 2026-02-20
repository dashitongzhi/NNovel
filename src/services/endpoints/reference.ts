import { apiClient } from "@/services/apiClient";
import type { AppConfig } from "@/types/domain";

export interface ReferenceOptimizePayload
  extends Partial<
    Pick<
      AppConfig,
      | "engine_mode"
      | "codex_model"
      | "gemini_model"
      | "claude_model"
      | "codex_access_mode"
      | "gemini_access_mode"
      | "claude_access_mode"
      | "codex_reasoning_effort"
      | "gemini_reasoning_effort"
      | "claude_reasoning_effort"
      | "doubao_reasoning_effort"
      | "doubao_models"
      | "doubao_model"
      | "personal_models"
      | "personal_model"
      | "proxy_port"
    >
  > {
  reference: string;
}

export interface ReferenceOptimizeResponse {
  ok: boolean;
  reference: string;
  engine_mode?: string;
  model?: string;
}

export function optimizeReference(payload: ReferenceOptimizePayload): Promise<ReferenceOptimizeResponse> {
  return apiClient.post<ReferenceOptimizeResponse>("/api/reference/optimize", payload);
}
