import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api, isAdmin, setSession } from '../lib/api';
import type { User } from '../lib/api';
import { logger } from '../lib/logger';
import { Button, Note, Page, TextInput } from '../components/ui';

/** Email + password rules shared with the backend (auth.go: valid email, min 8 chars). */
export function validateLogin(email: string, password: string): string | null {
  if (!email.includes('@')) return 'Enter a valid email address.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

/** Login-only page: the CMS has no signup. Redirects admins to the dashboard. */
export function LoginPage({ user, onLogin }: { user: User | null; onLogin: (u: User) => void }) {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (user && isAdmin(user)) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = validateLogin(email.trim(), password);
    if (invalid) {
      setErr(invalid);
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const d = await api<{ access_token: string; user: User }>('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      // Platform isolation: never keep a non-admin session in the CMS, even
      // when an old token was issued before the backend 403 gate.
      if (!isAdmin(d.user)) {
        setSession(null);
        setErr('This account cannot sign in on the admin (CMS) platform. Use your own platform instead.');
        return;
      }
      setSession({ accessToken: d.access_token, user: d.user });
      onLogin(d.user);
      nav('/');
    } catch (e2) {
      logger.warn('admin login failed', {});
      setErr(e2 instanceof Error ? e2.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <div className="tb-auth">
        <h1 className="tb-display">Back Office</h1>
        <p className="tb-sub">Admin sign in. Review couriers and merchants, approve or reject partnerships.</p>
        <div className="tb-card mt-4">
          <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)} noValidate>
            <TextInput
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(v) => setEmail(v)}
              placeholder="admin@example.com"
            />
            <TextInput
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(v) => setPassword(v)}
              placeholder="••••••••"
            />
            {err && <Note tone="error">{err}</Note>}
            <Button type="submit" block disabled={busy}>
              {busy ? '…' : 'Sign in'}
            </Button>
          </form>
        </div>
      </div>
    </Page>
  );
}

/** Gate: unauthenticated visitors go to /login; non-admins see a notice. */
export function RequireAdmin({ user, children }: { user: User | null; children: ReactNode }) {
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin(user)) {
    return (
      <Page>
        <Note tone="error">This account is not an admin. Partner review needs an admin role.</Note>
      </Page>
    );
  }
  return <>{children}</>;
}
