/**
 * Shared `GET /auth/me` probe. The cached user alone is never trusted: the
 * call must succeed (transparent refresh included). RequireAuth and the
 * app-level work-session tracker observe this one query, so they agree on
 * who is signed in and the probe runs once per stale window.
 */
import { useQuery } from '@tanstack/react-query';
import { api, savedUser } from '../../lib/api';

const AUTH_ME_KEY = ['auth-me'] as const;
const AUTH_ME_STALE_MS = 60_000;

/** Auth probe state for route guards and app-level owners. */
export type AuthProbe = {
  /** A user is cached on this device (the server may still reject it). */
  cached: boolean;
  /** The server check has not answered yet. */
  pending: boolean;
  /** The server rejected the session (or the probe failed). */
  failed: boolean;
  /** Signed in and confirmed by `GET /auth/me`. */
  confirmed: boolean;
};

/** Read the shared auth probe (one cache entry for every caller). */
export function useAuthMe(): AuthProbe {
  const cached = savedUser() !== null;
  const me = useQuery({
    queryKey: AUTH_ME_KEY,
    queryFn: () => api<{ id: string }>('/auth/me'),
    enabled: cached,
    retry: false,
    staleTime: AUTH_ME_STALE_MS,
  });
  return { cached, pending: me.isPending, failed: me.isError, confirmed: cached && me.isSuccess };
}
