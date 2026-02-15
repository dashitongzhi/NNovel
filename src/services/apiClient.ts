import type { ApiError, ApiErrorPayload } from "@/types/api";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").trim();
const DEV_LOCAL_BACKEND = import.meta.env.DEV && /^https?:\/\/(?:127\.0\.0\.1|localhost):(?:5000|5050)\/?$/i.test(API_BASE);

function buildUrl(path: string): string {
  // In Vite dev we proxy /api -> 127.0.0.1:5050, so prefer same-origin path to avoid CORS.
  if (DEV_LOCAL_BACKEND && /^\/api(?:\/|$)/.test(path)) return path;
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

async function request<T>(method: string, path: string, data?: unknown, options?: RequestInit): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(options?.headers || {}),
  };
  const requestInit: RequestInit = {
    ...(options || {}),
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  };
  const primaryUrl = buildUrl(path);
  let response: Response;
  try {
    response = await fetch(primaryUrl, requestInit);
  } catch (error) {
    const shouldRetryProxy =
      primaryUrl !== path
      && import.meta.env.DEV
      && /^\/api(?:\/|$)/.test(path);
    if (!shouldRetryProxy) {
      throw error;
    }
    response = await fetch(path, requestInit);
  }
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw toApiError(response, payload);
  }
  return payload as T;
}

export const apiClient = {
  get<T>(path: string, options?: RequestInit): Promise<T> {
    return request<T>("GET", path, undefined, options);
  },
  post<T>(path: string, data?: unknown, options?: RequestInit): Promise<T> {
    return request<T>("POST", path, data, options);
  },
  put<T>(path: string, data?: unknown, options?: RequestInit): Promise<T> {
    return request<T>("PUT", path, data, options);
  },
  delete<T>(path: string, data?: unknown, options?: RequestInit): Promise<T> {
    return request<T>("DELETE", path, data, options);
  },
};
