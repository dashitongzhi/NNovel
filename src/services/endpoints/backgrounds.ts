import { apiClient } from "@/services/apiClient";
import type { BackgroundItem } from "@/config/backgroundLibrary";

export interface BackgroundLibraryPayload {
  items?: BackgroundItem[];
}

export function getBackgroundLibrary(): Promise<BackgroundLibraryPayload> {
  return apiClient.get<BackgroundLibraryPayload>("/api/background/library");
}
