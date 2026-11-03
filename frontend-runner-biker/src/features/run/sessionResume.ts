/**
 * Refresh resume: confirm a refresh-restored work session with the server
 * (POST /courier/sessions resumes the live row instead of opening a second
 * one, PLAN §3). Same id → counters continue untouched; new id (old row
 * ended while away) → buffered points are re-tagged and counters restart;
 * 403 → sanctioned, the snapshot is dropped; unreachable → stay
 * device-local, the GPS backlog auto-registers on reconnect.
 *
 * Runs from the app-level `WorkSessionTracker`, so a reload on any screen
 * (not only Run Mode) is confirmed before the tracker's uploads can pile up
 * under an ended id. The run store's `resuming` flag drives the
 * "Reconnecting your run…" note on Run Mode.
 */
import { ApiError } from '../../lib/api';
import { retargetPoints } from '../../lib/db';
import { logger } from '../../lib/logger';
import { startWorkSession } from './sessionApi';
import { useRun } from './sessionStore';

/** What the resume did — the caller only acts on `blocked`. */
export type ResumeOutcome = 'skipped' | 'same' | 'fresh' | 'blocked' | 'offline' | 'superseded';

/**
 * One server confirmation per session id per page lifetime: module scope
 * survives remounts; a fresh id (new run) resumes again, correctly.
 */
let resumedFor: string | null = null;

/** True while `id` is still the active session (not ended or replaced). */
function isStillActive(id: string): boolean {
  const s = useRun.getState();
  return s.phase === 'active' && s.sessionId === id;
}

/** Confirm the active session with the server (no-op once per id). */
export async function resumeWorkSession(): Promise<ResumeOutcome> {
  const snap = useRun.getState();
  if (snap.phase !== 'active' || !snap.sessionId || !snap.setup) return 'skipped';
  if (resumedFor === snap.sessionId) return 'skipped';
  const resumeId = snap.sessionId;
  const setup = snap.setup;
  resumedFor = resumeId;
  snap.setResuming(true);
  try {
    const created = await startWorkSession({
      mode: setup.mode,
      goalKind: setup.goalKind,
      goalValue: setup.goalValue,
      plannedTrack: setup.plannedTrack,
    });
    // Ended (or replaced) while the call was out: never resurrect it.
    if (!isStillActive(resumeId)) return 'superseded';
    const same = created.sessionId === resumeId;
    if (!same) {
      try {
        await retargetPoints({ from: resumeId, to: created.sessionId });
      } catch (err) {
        logger.warn('backlog re-tag failed, old points stay buffered', err);
      }
      if (!isStillActive(resumeId)) return 'superseded';
    }
    // The adopted id is server-confirmed: never re-confirm it this page.
    resumedFor = created.sessionId;
    useRun.getState().start({ setup, sessionId: created.sessionId, serverLinked: true, keepStats: same });
    if (!same) logger.info('resume opened a fresh server session, counters restart');
    return same ? 'same' : 'fresh';
  } catch (err) {
    if (!isStillActive(resumeId)) return 'superseded';
    if (err instanceof ApiError && err.status === 403) {
      useRun.getState().reset();
      return 'blocked';
    }
    logger.warn('resume failed, staying device-local', err);
    useRun.getState().start({ setup, sessionId: resumeId, serverLinked: false, keepStats: true });
    return 'offline';
  } finally {
    useRun.getState().setResuming(false);
  }
}
