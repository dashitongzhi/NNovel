import { apiClient } from "@/services/apiClient";
import type { AppConfig } from "@/types/domain";

export interface ReferenceOptimizePayload extends Partial<AppConfig> {
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

