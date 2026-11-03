/** Typed fetch wrapper: in-memory access token, X-TF-App, refresh on 401. */
export const APP = "customer" as const;
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api/v1";

export type Problem = { title: string; detail: string; status: number };
export class ApiError extends Error {
    status: number;
    constructor(p: Problem) {
        super(p.detail || p.title);
        this.status = p.status;
    }
}

type Session = {
    accessToken: string;
    user: { id: string; email: string; roles: string[] };
} | null;
let session: Session = null;
export function setSession(s: Session) {
    session = s;
    if (s) localStorage.setItem("tb:customer:user", JSON.stringify(s.user));
    else localStorage.removeItem("tb:customer:user");
}
export function getSession(): Session {
    return session;
}
export function savedUser(): {
    id: string;
    email: string;
    roles: string[];
} | null {
    try {
        const raw = localStorage.getItem("tb:customer:user");
        return raw
            ? (JSON.parse(raw) as {
                  id: string;
                  email: string;
                  roles: string[];
              })
            : null;
    } catch {
        return null;
    }
}

/** Auth paths that never trigger a refresh (same allowlist as the CMS app):
 * everything else retries once after refreshing the access token, so a
 * boot-time `GET /auth/me` with an expired token still recovers. */
const NO_REFRESH = ["/auth/login", "/auth/refresh", "/auth/logout", "/auth/signup", "/auth/demo-login"];

function needsRefresh(path: string): boolean {
    return !NO_REFRESH.some((p) => path === p || path.startsWith(`${p}?`));
}

async function raw(
    path: string,
    init: RequestInit,
    retry: boolean,
): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("X-TF-App", APP);
    if (session?.accessToken)
        headers.set("Authorization", `Bearer ${session.accessToken}`);
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers,
        credentials: "include",
    });
    if (res.status === 401 && retry && needsRefresh(path)) {
        const rr = await fetch(`${BASE}/auth/refresh?app=${APP}`, {
            method: "POST",
            headers: { "X-TF-App": APP },
            credentials: "include",
        });
        if (rr.ok) {
            const data = (await rr.json()) as {
                access_token: string;
                user: Session extends null
                    ? never
                    : { id: string; email: string; roles: string[] };
            };
            session = {
                accessToken: data.access_token,
                user: data.user as {
                    id: string;
                    email: string;
                    roles: string[];
                },
            };
            return raw(path, init, false);
        }
    }
    return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await raw(path, init, true);
    if (!res.ok) {
        let detail = res.statusText;
        try {
            const p = (await res.json()) as Problem;
            detail = p.detail || p.title || detail;
            throw new ApiError({
                title: p.title ?? "Error",
                detail,
                status: res.status,
            });
        } catch (e) {
            if (e instanceof ApiError) throw e;
            throw new ApiError({ title: "Error", detail, status: res.status });
        }
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
}

export async function wsTicket(): Promise<string> {
    const d = await api<{ ticket: string }>("/ws/ticket", { method: "POST" });
    return d.ticket;
}

/** Server sign-out: clears the HttpOnly per-app refresh cookie so a copied
 * token can't be refreshed afterwards. Best-effort: offline logout still
 * clears local state via the caller's `setSession(null)`. */
export async function logout(): Promise<void> {
    try {
        // Touch a refreshable endpoint first so an expired access token is
        // renewed from the cookie before sign-out; otherwise the POST below
        // 401s and the refresh cookie survives.
        await api<unknown>("/auth/me");
        await api<void>("/auth/logout", { method: "POST" });
    } catch {
        /* local sign-out proceeds regardless */
    }
}
