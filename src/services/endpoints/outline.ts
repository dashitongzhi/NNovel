import { apiClient } from "@/services/apiClient";
import type { OutlineGeneratePayload } from "@/types/domain";

export function generateOutline(payload: OutlineGeneratePayload): Promise<{ ok: boolean; outline: string }> {
  return apiClient.post<{ ok: boolean; outline: string }>("/api/outline/generate", payload);
}
