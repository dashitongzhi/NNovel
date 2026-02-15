import { apiClient } from "@/services/apiClient";

export function getSelfCheck(): Promise<{ ok?: boolean; checks?: Array<{ label: string; ok: boolean; detail?: string }> }> {
  return apiClient.get("/api/self-check");
}
