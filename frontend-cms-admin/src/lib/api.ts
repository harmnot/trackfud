/** Typed fetch wrapper: in-memory access token, X-TF-App, refresh on 401. */
export const APP = 'cms' as const;
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type User = { id: string; email: string; roles: string[] };
let session: { accessToken: string; user: User } | null = null;
export function setSession(s: { accessToken: string; user: User } | null) {
  session = s;
  if (s) localStorage.setItem('tb:cms:user', JSON.stringify(s.user));
  else localStorage.removeItem('tb:cms:user');
}
export function savedUser(): User | null {
  try {
    const raw = localStorage.getItem('tb:cms:user');
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}
export function isAdmin(u: User | null): boolean {
  return u !== null && u.roles.includes('admin');
}

/** Auth paths that must never trigger a refresh (they create or end the session). */
const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/signup', '/auth/demo-login'];

function needsRefresh(path: string): boolean {
  return !NO_REFRESH.some((p) => path === p || path.startsWith(`${p}?`));
}

async function raw(path: string, init: RequestInit, retry: boolean): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-TF-App', APP);
  if (session?.accessToken) headers.set('Authorization', `Bearer ${session.accessToken}`);
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (res.status === 401 && retry && needsRefresh(path)) {
    if (await refreshSession()) return raw(path, init, false);
  }
  return res;
}

/**
 * Rotate the session via the HttpOnly refresh cookie. Returns true when a new
 * access token was stored; false leaves the caller to surface the 401.
 */
export async function refreshSession(): Promise<boolean> {
  try {
    const rr = await fetch(`${BASE}/auth/refresh?app=${APP}`, {
      method: 'POST',
      headers: { 'X-TF-App': APP },
      credentials: 'include',
    });
    if (!rr.ok) return false;
    const data = (await rr.json()) as { access_token: string; user: User };
    if (!data.access_token || !data.user) return false;
    setSession({ accessToken: data.access_token, user: data.user });
    return true;
  } catch {
    return false;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await raw(path, init, true);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const p = (await res.json()) as { detail?: string; title?: string };
      msg = p.detail || p.title || msg;
    } catch { /* keep status text */ }
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Fetch a stored file's bytes with the admin bearer token. Private files
 * (ID photos, selfies, checkpoint shots) require auth, so review images
 * cannot use a plain <img src> — callers turn the blob into an object URL.
 */
export async function fetchFileBlob(fileId: string): Promise<Blob> {
  const res = await raw(`/files/${fileId}/content`, {}, true);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const p = (await res.json()) as { detail?: string; title?: string };
      msg = p.detail || p.title || msg;
    } catch { /* keep status text */ }
    throw new ApiError(msg, res.status);
  }
  return res.blob();
}
