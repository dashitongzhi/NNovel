import { apiClient } from "@/services/apiClient";
import type { AppConfig, SelfCheckResponse, StartupStatus } from "@/types/domain";

export function getStatus(): Promise<StartupStatus> {
  return apiClient.get<StartupStatus>("/api/status");
}

export function prewarmEngine(): Promise<{ ok: boolean; started: boolean }> {
  return apiClient.post<{ ok: boolean; started: boolean }>("/api/engine/prewarm", {});
}

export function testConnectivity(config: Partial<AppConfig>): Promise<{ ok: boolean; message?: string }> {
  return apiClient.post<{ ok: boolean; message?: string }>("/api/engine/test-connectivity", config);
}

export function getSelfCheck(): Promise<SelfCheckResponse> {
  return apiClient.get<SelfCheckResponse>("/api/self-check");
}

export function saveProxyPort(proxyPort: string): Promise<{ ok: boolean; proxy_port: string; proxy_url?: string }> {
  return apiClient.post<{ ok: boolean; proxy_port: string; proxy_url?: string }>("/api/config/proxy", {
    proxy_port: proxyPort,
  });
}
