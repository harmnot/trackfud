import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, savedUser, setSession } from '../../lib/api';
import { Page } from '../../components/ui';

/**
 * Route guard: every screen except login/signup needs a live session.
 * The cached user alone is not trusted — `GET /auth/me` must succeed
 * (transparent refresh included), so a stale or edited localStorage entry
 * still lands on the login screen.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const cached = savedUser();
  const me = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api<{ id: string }>('/auth/me'),
    enabled: cached !== null,
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (me.isError) setSession(null);
  }, [me.isError]);

  if (!cached) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (me.isPending || me.isError) {
    return (
      <Page>
        <div className="tb-skel" style={{ height: 120 }} role="status" aria-label="Loading" />
      </Page>
    );
  }
  return children;
}
