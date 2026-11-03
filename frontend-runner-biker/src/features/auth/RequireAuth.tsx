import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router';
import { setSession } from '../../lib/api';
import { Page } from '../../components/ui';
import { useAuthMe } from './useAuthMe';

/**
 * Route guard: every screen except login/signup needs a live session.
 * The cached user alone is not trusted — `GET /auth/me` must succeed
 * (transparent refresh included), so a stale or edited localStorage entry
 * still lands on the login screen.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const auth = useAuthMe();

  useEffect(() => {
    if (auth.failed) setSession(null);
  }, [auth.failed]);

  if (!auth.cached) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (auth.pending || auth.failed) {
    return (
      <Page>
        <div className="tb-skel" style={{ height: 120 }} role="status" aria-label="Loading" />
      </Page>
    );
  }
  return children;
}
