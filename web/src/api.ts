// Relative by default (Vite proxies /api in development). A deployed frontend
// points at the API origin with VITE_API_URL; the /api prefix is added unless the
// value already carries it, so both https://api.example.com and
// https://api.example.com/api work.
function resolveBase(): string {
  const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, '');
  if (!configured) return '/api';
  return configured.endsWith('/api') ? configured : `${configured}/api`;
}

const BASE = resolveBase();
const TOKEN_KEY = 'knowbridge.token';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function readToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function writeToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`;
    if (response.status === 401 && readToken()) {
      writeToken(null);
      window.dispatchEvent(new Event('knowbridge:signed-out'));
    }
    throw new ApiError(response.status, message);
  }
  return payload as T;
}

export function navigate(path: string): void {
  window.location.hash = path;
}
