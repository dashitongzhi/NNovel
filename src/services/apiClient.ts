import type { ApiError, ApiErrorPayload } from "@/types/api";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").trim();

function buildUrl(path: string): string {
  if (!API_BASE) return path;
  if (/^https?:\/\//i.test(path)) return path;
  const left = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;
  const right = path.startsWith("/") ? path : `/${path}`;
  return `${left}${right}`;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function toApiError(response: Response, payload: unknown): ApiError {
  const body = (payload ?? {}) as ApiErrorPayload;
  const err = new Error(body.message || `HTTP ${response.status}`) as ApiError;
  err.status = response.status;
  err.errorCode = body.error_code || body.code || "";
  err.requestId = body.request_id || "";
  err.payload = payload;
  return err;
}

async function request<T>(method: string, path: string, data?: unknown): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw toApiError(response, payload);
  }
  return payload as T;
}

export const apiClient = {
  get<T>(path: string): Promise<T> {
    return request<T>("GET", path);
  },
  post<T>(path: string, data?: unknown): Promise<T> {
    return request<T>("POST", path, data);
  },
  put<T>(path: string, data?: unknown): Promise<T> {
    return request<T>("PUT", path, data);
  },
  delete<T>(path: string, data?: unknown): Promise<T> {
    return request<T>("DELETE", path, data);
  },
};
