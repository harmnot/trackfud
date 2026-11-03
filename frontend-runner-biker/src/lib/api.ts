/** Typed fetch wrapper: in-memory access token, X-TF-App, refresh on 401. */
export const APP = "courier" as const;
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
    if (s) localStorage.setItem("tb:courier:user", JSON.stringify(s.user));
    else localStorage.removeItem("tb:courier:user");
}
export function savedUser(): User | null {
    try {
        const raw = localStorage.getItem("tb:courier:user");
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

/** Extra fetch option: per-call timeout. Mobile dead zones and wedged
 * proxies hang `fetch` forever otherwise — every Go-online, resume, offer
 * poll and ticket call would stall with no error and no fallback. */
export type ApiInit = RequestInit & { timeoutMs?: number };
const API_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: ctrl.signal });
    } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
            throw new ApiError("request timed out — check your connection", 408);
        }
        throw err;
    } finally {
        window.clearTimeout(timer);
    }
}

async function raw(
    path: string,
    init: ApiInit,
    retry: boolean,
): Promise<Response> {
    const { timeoutMs = API_TIMEOUT_MS, ...reqInit } = init;
    const headers = new Headers(reqInit.headers);
    headers.set("X-TF-App", APP);
    if (session?.accessToken)
        headers.set("Authorization", `Bearer ${session.accessToken}`);
    const res = await fetchWithTimeout(
        `${BASE}${path}`,
        { ...reqInit, headers, credentials: "include" },
        timeoutMs,
    );
    if (res.status === 401 && retry && needsRefresh(path)) {
        const rr = await fetchWithTimeout(
            `${BASE}/auth/refresh?app=${APP}`,
            {
                method: "POST",
                headers: { "X-TF-App": APP },
                credentials: "include",
            },
            API_TIMEOUT_MS,
        );
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

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
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

/** Upload a file through the presign contract (shrunk by caller if image). */
export async function uploadViaPresign(args: {
    file: File;
    bucket: "public" | "private";
}): Promise<string> {
    const pre = await api<{
        file_id: string;
        upload_url: string;
        storage?: "r2" | "local";
    }>(
        "/files/presign",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                bucket: args.bucket,
                content_type: args.file.type || "image/jpeg",
                size_bytes: args.file.size,
            }),
        },
    );
    const isR2 = pre.storage === "r2";
    const res = await fetchWithTimeout(
        pre.upload_url,
        {
            method: "PUT",
            headers: { "Content-Type": args.file.type || "image/jpeg" },
            body: args.file,
            // R2 presigned PUTs are bearer URLs: never send our cookies there.
            credentials: isR2 ? "omit" : "include",
        },
        120000,
    );
    if (!res.ok) throw new ApiError("upload failed", res.status);
    if (isR2) {
        await api(`/files/${pre.file_id}/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ size_bytes: args.file.size }),
        });
    }
    return pre.file_id;
}
