export interface ApiError extends Error {
  status?: number;
  errorCode?: string;
  requestId?: string;
  payload?: unknown;
}

export interface ApiErrorPayload {
  message?: string;
  error_code?: string;
  code?: string;
  request_id?: string;
}
