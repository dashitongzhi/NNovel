import { apiClient } from "@/services/apiClient";
import type { AppConfig } from "@/types/domain";

export function getConfig(): Promise<AppConfig> {
  return apiClient.get<AppConfig>("/api/config");
}

export function saveConfig(config: AppConfig): Promise<AppConfig> {
  return apiClient.post<AppConfig>("/api/config", config);
}

export function getStatus(): Promise<{ ok?: boolean; message?: string }> {
  return apiClient.get<{ ok?: boolean; message?: string }>("/api/status");
}
