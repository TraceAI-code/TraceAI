/**
 * Shared API client for all TraceAI backend requests.
 * Proxied through Vite dev server to http://127.0.0.1:8000 during development.
 */

const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api/v1`
  : '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`API ${status}: ${detail}`);
    this.name = 'ApiError';
  }
}

/** Build a full API URL for direct downloads (evidence content, audit reports). */
export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

/** True only when the API explicitly returned 404 Not Found. */
export function isNotFound(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 404;
}

interface ValidationIssue {
  loc?: unknown[];
  msg?: string;
  type?: string;
}

function formatValidationIssues(issues: unknown[]): string {
  return issues
    .map((issue) => {
      if (!issue || typeof issue !== 'object') return String(issue);
      const { loc, msg } = issue as ValidationIssue;
      const field = Array.isArray(loc)
        ? loc.filter((part) => part !== 'body' && part !== 'query').join('.')
        : '';
      const message = msg ?? JSON.stringify(issue);
      return field ? `${field}: ${message}` : message;
    })
    .join('; ');
}

function formatDetail(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) return formatValidationIssues(detail) || fallback;
  if (detail && typeof detail === 'object') {
    try {
      return JSON.stringify(detail);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  });

  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? body.message ?? detail;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, formatDetail(detail, res.statusText));
  }

  // 204 No Content — return null
  if (res.status === 204) return null as T;

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
