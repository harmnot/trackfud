import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { api, isAdmin, refreshSession, savedUser, setSession } from './lib/api';
import type { User } from './lib/api';
import { logger } from './lib/logger';
import { LoginPage, RequireAdmin } from './features/auth';
import { Dashboard } from './features/dashboard';
import { OverviewPage } from './features/overview/OverviewPage';
import { PerformancePage } from './features/overview/PerformancePage';
import { CourierDetail, MerchantDetail } from './features/detail';
import { OrderDetailPage } from './features/orders/OrderDetailPage';
import { OrdersPage } from './features/orders/OrdersPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { AuditPage } from './features/audit/AuditPage';
import { AIPage } from './features/ai/AIPage';
import { CopilotPage } from './features/copilot/CopilotPage';
import { WithdrawalsPage } from './features/withdrawals/WithdrawalsPage';

/** Every Back Office destination in one list — the top bar (tablet/desktop)
 * and the bottom bar + More sheet (phones) render from here, so a new page
 * is one entry instead of three edits. Groups keep 8 destinations scannable:
 * Operate (daily work), Money, System. */
const NAV = [
  { to: '/', label: 'Overview', end: true, group: 'Operate', icon: 'grid' },
  { to: '/review', label: 'Review', group: 'Operate', icon: 'check' },
  { to: '/orders', label: 'Orders', group: 'Operate', icon: 'bag' },
  { to: '/withdrawals', label: 'Payouts', group: 'Money', icon: 'coin' },
  { to: '/settings', label: 'Settings', group: 'System', icon: 'gear' },
  { to: '/audit', label: 'Audit', group: 'System', icon: 'list' },
  { to: '/ai', label: 'AI', group: 'System', icon: 'spark' },
  { to: '/copilot', label: 'Copilot', group: 'System', icon: 'chat' },
] as const;

const GROUPS = ['Operate', 'Money', 'System'] as const;

/** Bottom-bar destinations on phones: four primaries + a More sheet. */
const PRIMARY = ['/', '/review', '/orders', '/withdrawals'] as const;
// NOTE: entries keep the leading slash; the tuple is compared with `n.to`.
function isPrimary(to: string): boolean {
  return (PRIMARY as readonly string[]).includes(to);
}

/** Minimal inline icon set (currentColor, 1.8px stroke, no emoji). */
function NavIcon({ name }: { name: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;
  switch (name) {
    case 'grid':
      return (
        <svg {...common} aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
      );
    case 'check':
      return (
        <svg {...common} aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12.2 2.4 2.4 4.6-5" /></svg>
      );
    case 'bag':
      return (
        <svg {...common} aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>
      );
    case 'coin':
      return (
        <svg {...common} aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4.5" /></svg>
      );
    case 'gear':
      return (
        <svg {...common} aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" /></svg>
      );
    case 'list':
      return (
        <svg {...common} aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
      );
    case 'spark':
      return (
        <svg {...common} aria-hidden="true"><path d="M12 3v5M12 16v5M3 12h5M16 12h5" /><circle cx="12" cy="12" r="2.4" /></svg>
      );
    case 'chat':
      return (
        <svg {...common} aria-hidden="true"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6z" /></svg>
      );
    default:
      return (
        <svg {...common} aria-hidden="true"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>
      );
  }
}

function Shell({ user, onLogout, children }: { user: User; onLogout: () => void; children: React.ReactNode }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [sysOpen, setSysOpen] = useState(false);
  const location = useLocation();
  // The More sheet and both menus never survive navigation.
  useEffect(() => {
    setMoreOpen(false);
    setUserOpen(false);
    setSysOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!userOpen && !sysOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setUserOpen(false);
        setSysOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [userOpen, sysOpen]);
  const primary = NAV.filter((n) => isPrimary(n.to));
  const secondary = NAV.filter((n) => !isPrimary(n.to));
  // System destinations live behind one top-bar menu on tablet/desktop (and
  // in the grouped More sheet on phones), so the bar stays at five slots
  // and never crowds a 768px viewport. One NAV list still owns the truth.
  const sysItems = NAV.filter((n) => n.group === 'System');
  const sysActive = sysItems.some((n) => location.pathname.startsWith(n.to));
  return (
    <div className="tb-shell">
      <header className="tb-topbar">
        <div className="tb-topbar-inner">
          <div className="tb-hello">
            <small>Trackfud · Back Office</small>
            <strong>Partner review</strong>
          </div>
          {/* Desktop account menu: email + sign out behind the avatar so the
              top bar never spends a slot on a sign-out link. */}
          <div className="tb-dd tb-user">
            <button
              type="button"
              className="tb-avatar tb-avatar-btn"
              aria-label={user.email}
              aria-expanded={userOpen}
              aria-haspopup="menu"
              onClick={() => setUserOpen((o) => !o)}
            >
              {user.email.slice(0, 1).toUpperCase()}
            </button>
            {userOpen && (
              <>
                <button type="button" className="tb-sheet-backdrop tb-menu-backdrop" aria-label="Close menu" onClick={() => setUserOpen(false)} />
                <div className="tb-menu tb-user-menu" role="menu" aria-label={user.email}>
                  <p className="tb-user-mail" title={user.email}>{user.email}</p>
                  <button type="button" role="menuitem" onClick={onLogout}>
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        {/* Slim top bar (tablet + desktop): four primaries + one System
            menu. Five slots fit 768px without scrolling or tiny pills; the
            same NAV list feeds the bottom bar + grouped More sheet. */}
        <nav className="tb-topnav" aria-label="Back office">
          {primary.map((n) => (
            <NavLink key={n.to} to={n.to} end={'end' in n && n.end === true}>
              <NavIcon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
          <span className="tb-dd tb-sys">
            <button
              type="button"
              className={`tb-sys-btn${sysActive ? ' on' : ''}${sysOpen ? ' open' : ''}`}
              aria-expanded={sysOpen}
              aria-haspopup="menu"
              onClick={() => setSysOpen((o) => !o)}
            >
              <NavIcon name="gear" />
              System
              <svg className="tb-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {sysOpen && (
              <>
                <button type="button" className="tb-sheet-backdrop tb-menu-backdrop" aria-label="Close menu" onClick={() => setSysOpen(false)} />
                <span className="tb-menu tb-sys-menu" role="menu" aria-label="System">
                  {sysItems.map((n) => (
                    <NavLink key={n.to} to={n.to} role="menuitem">
                      <NavIcon name={n.icon} />
                      {n.label}
                    </NavLink>
                  ))}
                </span>
              </>
            )}
          </span>
        </nav>
      </header>
      <main style={{ flex: 1, padding: '1rem 0 2rem' }}>{children}</main>
      {/* Phones: icon bottom bar with the four primaries + More. */}
      <nav className="tb-nav" aria-label="Back office">
        {primary.map((n) => (
          <NavLink key={n.to} to={n.to} end={'end' in n && n.end === true}>
            <NavIcon name={n.icon} />
            {n.label}
          </NavLink>
        ))}
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          className={moreOpen ? 'on' : undefined}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <NavIcon name="more" />
          More
        </button>
      </nav>
      {moreOpen && (
        <>
          <button
            type="button"
            className="tb-sheet-backdrop"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
          />
          <div className="tb-sheet" role="menu" aria-label="More sections">
            {/* Signed-in identity on top: phones hide nothing — the account
                menu avatar stays in the top bar, and the sheet repeats the
                email so sign-out is never anonymous. */}
            <p className="tb-sheet-mail" title={user.email}>{user.email}</p>
            {GROUPS.map((g) => {
              const items = secondary.filter((n) => n.group === g);
              if (items.length === 0) return null;
              return (
                <div key={g} className="tb-sheet-group" role="group" aria-label={g}>
                  <p className="tb-sheet-group-name" aria-hidden="true">{g}</p>
                  {items.map((n) => (
                    <NavLink key={n.to} to={n.to} role="menuitem">
                      <NavIcon name={n.icon} />
                      {n.label}
                    </NavLink>
                  ))}
                </div>
              );
            })}
            <button type="button" role="menuitem" onClick={onLogout}>
              <NavIcon name="more" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => savedUser());
  const [checking, setChecking] = useState(true);
  const nav = useNavigate();

  // Restore the session on load (including deep-link refreshes): the access
  // token lives only in memory, so rotate via the HttpOnly refresh cookie
  // first, then verify identity. A failed restore means signed out.
  useEffect(() => {
    let live = true;
    async function boot() {
      await refreshSession();
      try {
        const me = await api<User>('/auth/me');
        if (live) setUser(me);
      } catch {
        if (live) {
          setSession(null);
          setUser(null);
        }
      } finally {
        if (live) setChecking(false);
      }
    }
    void boot();
    return () => {
      live = false;
    };
  }, []);

  // Keep tabs in sync: sign-out in one tab signs out the others.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === 'tb:cms:user') setUser(savedUser());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
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
              <OverviewPage />
            </Shell>
          </RequireAdmin>
        }
      />
      <Route
        path="/review"
        element={
          <RequireAdmin user={user}>
            <Shell user={user as User} onLogout={logout}>
              <Dashboard />
            </Shell>
          </RequireAdmin>
        }
      />
      <Route
        path="/couriers/:userId/performance"
        element={
          <RequireAdmin user={user}>
            <Shell user={user as User} onLogout={logout}>
              <PerformancePage />
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
      <Route
        path="/withdrawals"
        element={
          <RequireAdmin user={user}>
            <Shell user={user as User} onLogout={logout}>
              <WithdrawalsPage />
            </Shell>
          </RequireAdmin>
        }
      />
      <Route
        path="/orders"
        element={
          <RequireAdmin user={user}>
            <Shell user={user as User} onLogout={logout}>
              <OrdersPage />
            </Shell>
          </RequireAdmin>
        }
      />
      <Route
        path="/orders/:id"
        element={
          <RequireAdmin user={user}>
            <Shell user={user as User} onLogout={logout}>
              <OrderDetailPage />
            </Shell>
          </RequireAdmin>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAdmin user={user}>
            <Shell user={user as User} onLogout={logout}>
              <SettingsPage />
            </Shell>
          </RequireAdmin>
        }
      />
      <Route
        path="/audit"
        element={
          <RequireAdmin user={user}>
            <Shell user={user as User} onLogout={logout}>
              <AuditPage />
            </Shell>
          </RequireAdmin>
        }
      />
      <Route
        path="/ai"
        element={
          <RequireAdmin user={user}>
            <Shell user={user as User} onLogout={logout}>
              <AIPage />
            </Shell>
          </RequireAdmin>
        }
      />
      <Route
        path="/copilot"
        element={
          <RequireAdmin user={user}>
            <Shell user={user as User} onLogout={logout}>
              <CopilotPage />
            </Shell>
          </RequireAdmin>
        }
      />
      <Route path="*" element={<Navigate to={user && isAdmin(user) ? '/' : '/login'} replace />} />
    </Routes>
  );
}
