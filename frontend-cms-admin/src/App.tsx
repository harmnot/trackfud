import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router';
import { api, isAdmin, savedUser, setSession } from './lib/api';
import type { User } from './lib/api';
import { logger } from './lib/logger';
import { LoginPage, RequireAdmin } from './features/auth';
import { Dashboard } from './features/dashboard';
import { CourierDetail, MerchantDetail } from './features/detail';

function Shell({ user, onLogout, children }: { user: User; onLogout: () => void; children: React.ReactNode }) {
  return (
    <div className="tb-shell">
      <header className="tb-topbar">
        <div className="tb-topbar-inner">
          <div className="tb-hello">
            <small>Trackfud · Back Office</small>
            <strong>Partner review</strong>
          </div>
          <span className="tb-avatar" title={user.email} aria-label={user.email}>
            {user.email.slice(0, 1).toUpperCase()}
          </span>
        </div>
      </header>
      <main style={{ flex: 1, padding: '1rem 0 2rem' }}>{children}</main>
      <nav className="tb-nav" aria-label="Back office">
        <NavLink to="/">Review</NavLink>
        <button onClick={onLogout}>Sign out</button>
      </nav>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => savedUser());
  const [checking, setChecking] = useState(user !== null);
  const nav = useNavigate();

  // Re-verify the saved session against the API on load.
  useEffect(() => {
    if (!savedUser()) return;
    let live = true;
    api<User>('/auth/me')
      .then((me) => {
        if (live) setUser(me);
      })
      .catch(() => {
        if (live) {
          setSession(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, []);

  function logout() {
    api('/auth/logout', { method: 'POST' }).catch((e: unknown) => {
      logger.warn('logout failed', {});
      void e;
    });
    setSession(null);
    setUser(null);
    nav('/login');
  }

  if (checking) {
    return (
      <div className="tb-shell">
        <main style={{ padding: '2rem 0' }}>
          <div className="tb-skel" style={{ height: 120 }} />
        </main>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage user={user} onLogin={setUser} />} />
      <Route
        path="/"
        element={
          <RequireAdmin user={user}>
            <Shell user={user as User} onLogout={logout}>
              <Dashboard />
            </Shell>
          </RequireAdmin>
        }
      />
      <Route
        path="/couriers/:userId"
        element={
          <RequireAdmin user={user}>
            <Shell user={user as User} onLogout={logout}>
              <CourierDetail />
            </Shell>
          </RequireAdmin>
        }
      />
      <Route
        path="/merchants/:id"
        element={
          <RequireAdmin user={user}>
            <Shell user={user as User} onLogout={logout}>
              <MerchantDetail />
            </Shell>
          </RequireAdmin>
        }
      />
      <Route path="*" element={<Navigate to={user && isAdmin(user) ? '/' : '/login'} replace />} />
    </Routes>
  );
}
