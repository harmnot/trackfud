/** Typed fetch wrapper: in-memory access token, X-TF-App, refresh on 401. */
export const APP = "merchant" as const;
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api/v1";

export class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

type User = { id: string; email: string; roles: string[] };
let session: { accessToken: string; user: User } | null = null;
export function setSession(s: { accessToken: string; user: User } | null) {
    session = s;
    if (s) localStorage.setItem("tb:merchant:user", JSON.stringify(s.user));
    else localStorage.removeItem("tb:merchant:user");
}
export function savedUser(): User | null {
    try {
        const raw = localStorage.getItem("tb:merchant:user");
        return raw ? (JSON.parse(raw) as User) : null;
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
                user: User;
            };
            session = { accessToken: data.access_token, user: data.user };
            return raw(path, init, false);
        }
    }
    return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await raw(path, init, true);
    if (!res.ok) {
        let msg = res.statusText;
        try {
            const p = (await res.json()) as { detail?: string; title?: string };
            msg = p.detail || p.title || msg;
        } catch {
            /* keep status text */
        }
        throw new ApiError(msg, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
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
