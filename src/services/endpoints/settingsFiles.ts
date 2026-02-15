import { apiClient } from "@/services/apiClient";
import type { SettingsFilePayload } from "@/types/domain";

export function getSettingsFile(): Promise<SettingsFilePayload> {
  return apiClient.get<SettingsFilePayload>("/api/settings/file");
}

export function saveSettingsFile(content: string): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>("/api/settings/file", { content });
}

export function restoreSettingsFile(): Promise<{ ok: boolean; backup_path?: string }> {
  return apiClient.post<{ ok: boolean; backup_path?: string }>("/api/settings/file/restore", {});
}

export function openSettingsFile(): Promise<{ ok: boolean; path?: string; message?: string }> {
  return apiClient.post<{ ok: boolean; path?: string; message?: string }>("/api/settings/open", {});
}

export function getAuthFile(): Promise<SettingsFilePayload> {
  return apiClient.get<SettingsFilePayload>("/api/auth/file");
}

export function saveAuthFile(content: string): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>("/api/auth/file", { content });
}

export function restoreAuthFile(): Promise<{ ok: boolean; backup_path?: string }> {
  return apiClient.post<{ ok: boolean; backup_path?: string }>("/api/auth/file/restore", {});
}

export function openAuthFile(): Promise<{ ok: boolean; path?: string; message?: string }> {
  return apiClient.post<{ ok: boolean; path?: string; message?: string }>("/api/auth/open", {});
}
