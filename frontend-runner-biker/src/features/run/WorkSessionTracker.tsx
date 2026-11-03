/**
 * App-level owner of live GPS tracking, mounted once beside the routes so
 * navigation never unmounts it. While a signed-in courier has an active
 * work session, the one run tracker streams on every screen — Run,
 * Delivery, Chat, Orders, Wallet — so the customer's live dot and the
 * kitchen ETA keep moving when the courier leaves Run Mode. It stops when
 * the session ends or the user signs out, and confirms a refresh-restored
 * session with the server once per id. Renders nothing: screens read the
 * run store, none of them owns a watcher.
 */
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ROUTES } from '../../app/routes';
import { useAuthMe } from '../auth/useAuthMe';
import { useRun } from './sessionStore';
import { startRunTracking, stopRunTracking } from './runTracker';
import { resumeWorkSession } from './sessionResume';

export function WorkSessionTracker(): null {
  const nav = useNavigate();
  const { pathname } = useLocation();
  // Latest router values for the async resume outcome (effects below stay
  // keyed on the session only, not on every navigation).
  const latest = useRef({ nav, pathname });
  const { confirmed } = useAuthMe();
  const activeId = useRun((s) => (s.phase === 'active' && s.setup ? s.sessionId : null));
  // Same gate as the old Run Mode mount: auth confirmed + session recording.
  const trackedId = confirmed ? activeId : null;

  useEffect(() => {
    latest.current = { nav, pathname };
  }, [nav, pathname]);

  // The one GPS watch + batched uploads for the active session.
  useEffect(() => {
    if (!trackedId) return;
    startRunTracking(trackedId);
    return () => stopRunTracking();
  }, [trackedId]);

  // Refresh resume, once per session id (guarded inside). A sanctioned
  // account drops the session; only Run Mode — left with nothing to show —
  // sends the courier to setup, where the reason is explained. Other
  // screens (e.g. a delivery leg) stay put and show their own notice.
  useEffect(() => {
    if (!trackedId) return;
    void (async () => {
      const outcome = await resumeWorkSession();
      if (outcome !== 'blocked' || latest.current.pathname !== ROUTES.run) return;
      latest.current.nav(ROUTES.runSetup);
    })();
  }, [trackedId]);

  return null;
}
