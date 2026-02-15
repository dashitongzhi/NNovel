import { apiClient } from "@/services/apiClient";
import type { AppConfig, GenerationStatusResponse } from "@/types/domain";

export function startGenerate(config: AppConfig): Promise<{ task_id: string; request_id?: string }> {
  return apiClient.post<{ task_id: string; request_id?: string }>("/api/generate", config);
}

export function getGenerateStatus(taskId: string): Promise<GenerationStatusResponse> {
  return apiClient.get<GenerationStatusResponse>(`/api/generate/status/${taskId}`);
}

export function stopGenerate(taskId: string): Promise<{ ok: boolean; state?: string; request_id?: string }> {
  return apiClient.post<{ ok: boolean; state?: string; request_id?: string }>(`/api/generate/stop/${taskId}`, {});
}

export function pauseGenerate(taskId: string, paused: boolean): Promise<{ ok: boolean; state?: string; paused?: boolean; request_id?: string }> {
  return apiClient.post<{ ok: boolean; state?: string; paused?: boolean; request_id?: string }>(`/api/generate/pause/${taskId}`, { paused });
}

export function savePauseSnapshot(data: {
  task_id: string;
  request_id?: string;
  content: string;
}): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>("/api/generate/pause-snapshot", data);
}

export function resumeGenerate(): Promise<{ ok: boolean; task_id?: string; request_id?: string }> {
  return apiClient.post<{ ok: boolean; task_id?: string; request_id?: string }>("/api/generate/resume", {});
}

export function getRecovery(): Promise<{
  recoverable: boolean;
  task_id?: string;
  request_id?: string;
  partial_content?: string;
  thinking?: string;
  live_task?: boolean;
  live_state?: string;
}> {
  return apiClient.get("/api/generate/recovery");
}
