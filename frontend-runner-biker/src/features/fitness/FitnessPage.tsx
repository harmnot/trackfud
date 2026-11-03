/**
 * Fitness test — what it is and how it works.
 *
 * Purpose: prove you can cover the partner distance (runner 2 km, biker
 * 5 km) within the moving-time limit before CMS review. The phone records
 * GPS fixes while you move; the server evaluates distance + moving time +
 * elapsed cap + GPS gaps and marks pass/fail. A pass lets you submit the
 * partner application; the review team decides in Back Office.
 *
 * Expected behavior:
 * - Start recording → GPS streams, elapsed ticks every second, moving time
 *   counts only while you actually move (≥0.5 m/s, gaps ≤30 s — same rule as
 *   the server). Standing still advances elapsed but not moving.
 * - Stop → recording ends, numbers freeze.
 * - Submit test + application is DISABLED while recording (so you cannot
 *   submit a half track) and re-enabled after stop. It posts the live
 *   recording to /courier/fitness-test, then the application to
 *   /courier/application/submit. No manual/demo values — everything shown
 *   comes from /config/public and /courier/application.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ApiError } from '../../lib/api';
import { formatSubmittedAt } from '../../lib/format';
import { Button, Dropdown, Note, Page, Ring, Stat } from '../../components/ui';
import { useStaff } from '../staff/staffStore';
import {
  fetchCourierApplication,
  fetchFitnessConfig,
  submitCourierApplication,
  submitFitnessTest,
} from './fitnessApi';
import { useFitnessRecorder, type FitnessMode } from './useFitnessRecorder';

/** Application states that lock the fitness test until the admin decides.
 * Approved partners never retake it (one-time gate, PLAN §8.2) and staff
 * skip it entirely (PLAN §4.2) — the route guard + navbar hide this page
 * for them; the flags below are defence-in-depth for direct renders. */
const REVIEW_LOCKED = ['pending', 'pending_review'];

function formatClock(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function FitnessPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['cfg'], queryFn: fetchFitnessConfig });
  const app = useQuery({ queryKey: ['courier-application'], queryFn: fetchCourierApplication });
  const [mode, setMode] = useState<FitnessMode>('runner');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [submitErr, setSubmitErr] = useState('');
  const rec = useFitnessRecorder(mode);
  const staffActive = useStaff((s) => s.active);

  const target =
    mode === 'biker' ? cfg.data?.fitness.biker_distance_m : cfg.data?.fitness.runner_distance_m;
  const progress = target ? Math.min(1, rec.distanceM / target) : 0;
  const hasRecording = rec.points > 0 || rec.distanceM > 0;
  // Locked while the review team decides: the courier cannot record or
  // submit another test until the admin approves or rejects (enforced
  // server-side too — the buttons stay disabled, not hidden).
  const locked = app.data !== undefined && REVIEW_LOCKED.includes(app.data.status);
  // One-time gate: approved partners passed already, staff never take it.
  // The route guard hides this page for both; this disables the controls if
  // the component ever renders directly (e.g. stale query, tests).
  const isApproved = app.data?.status === 'approved';
  const gateClosed = locked || isApproved || staffActive;
  // Submit locks while GPS is streaming or while a submit is in flight —
  // a double-tap can never send two applications.
  const submitDisabled = rec.recording || busy || !hasRecording || gateClosed;
  const recordDisabled = busy || gateClosed;

  async function submit() {
    if (submitDisabled) return;
    setBusy(true);
    setSubmitErr('');
    setResult('');
    try {
      const fit = await submitFitnessTest({
        mode,
        distanceM: rec.distanceM,
        movingS: rec.movingS,
        elapsedS: rec.elapsedS,
        points: rec.points,
      });
      const sub = await submitCourierApplication();
      setResult(
        `${t('fitness.result')}: fitness ${fit.passed ? 'PASS ✓' : t('fitness.notYet', { defaultValue: 'not yet' })} · application ${sub.status}`,
      );
      await qc.invalidateQueries({ queryKey: ['courier-application'] });
    } catch (e) {
      setSubmitErr(e instanceof ApiError ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  const last = app.data?.fitness;

  return (
    <Page>
      <h1 className="tb-display">{t('fitness.title')}</h1>
      <p className="tb-sub">
        {t('fitness.purpose', {
          defaultValue:
            'Prove you can cover the partner distance on foot or pedal bike. Record a live GPS track — the server checks distance, moving time and gaps.',
        })}
      </p>
      <p className="tb-sub">
        {t('fitness.targetLine', { defaultValue: 'Target {{target}} m', target: target ?? '…' })} ·{' '}
        {t('app.safety')}
      </p>

      {staffActive && (
        <div className="mt-3">
          <Note tone="info">{t('staff.noTest')}</Note>
        </div>
      )}

      {isApproved && (
        <div className="mt-3 flex flex-col gap-2" role="status" aria-live="polite">
          <Note tone="info">
            {t('fitness.approved', {
              defaultValue:
                'Fitness test passed and account approved — no need to retake it. Head out for a run when ready.',
            })}
          </Note>
          <Link to="/status" className="tb-btn tb-btn-pine tb-btn-block">
            {t('fitness.backToStatus', { defaultValue: 'Back to account status' })}
          </Link>
        </div>
      )}

      {locked && (
        <div className="mt-3 flex flex-col gap-2" role="status" aria-live="polite">
          <Note tone="info">
            {t('fitness.locked', {
              defaultValue:
                'Already submitted on {{date}} — waiting for approval. Recording and submitting unlock after the review team approves or rejects your application.',
              date: formatSubmittedAt(app.data?.submitted_at),
            })}
          </Note>
          <Link to="/status" className="tb-btn tb-btn-pine tb-btn-block">
            {t('fitness.backToStatus', { defaultValue: 'Back to account status' })}
          </Link>
        </div>
      )}

      <div className="tb-timer mt-3">
        {rec.recording ? (
          <p className="tb-rec live">Recording · {rec.points} pts</p>
        ) : (
          <p className="tb-rec">Ready when you are</p>
        )}
        <div className="mt-3">
          <Ring progress={progress} center={formatClock(rec.movingS)} sub="moving time" />
        </div>
        <p className="mt-2 font-bold">
          {Math.round(rec.distanceM)} m · {rec.elapsedS}s elapsed
        </p>
      </div>

      <div className="tb-stats mt-3">
        <Stat value={`${Math.round(rec.distanceM)} m`} label={t('fitness.distance')} />
        <Stat value={`${rec.movingS}s`} label={t('fitness.moving')} />
        <Stat value={`${rec.elapsedS}s`} label={t('fitness.elapsed')} />
      </div>

      {last && (last.distance_m > 0 || last.moving_s > 0) && (
        <div className="tb-card mt-3">
          <p className="text-sm font-bold">
            {t('fitness.last', { defaultValue: 'Last submitted test (from server)' })}
          </p>
          <p className="tb-sub mt-1">
            {Math.round(last.distance_m)} m · {last.moving_s}s moving · {last.elapsed_s}s elapsed ·{' '}
            {last.passed
              ? t('fitness.passed', { defaultValue: 'passed ✓' })
              : t('fitness.notYet', { defaultValue: 'not yet' })}
          </p>
          {app.data?.status && (
            <p className="tb-sub mt-1">
              {t('fitness.appStatus', { defaultValue: 'Application: {{s}}', s: app.data.status })}
            </p>
          )}
        </div>
      )}

      <div className="mt-2">
        <p className="tb-label">{t('onboard.mode')}</p>
        <Dropdown
          label={t('onboard.mode')}
          full
          value={mode}
          options={[
            { value: 'runner', label: 'Runner', sub: '2 km / 15 min' },
            { value: 'biker', label: 'Biker', sub: '5 km / 20 min' },
          ]}
          onChange={(v) => setMode(v as FitnessMode)}
        />
      </div>

      <div className="flex flex-col gap-2 mt-3 sm:flex-row">
        <div className="flex-1">
          {!rec.recording ? (
            <Button block variant="sun" onClick={rec.start} disabled={recordDisabled}>
              {t('fitness.start')}
            </Button>
          ) : (
            <Button block variant="danger" onClick={rec.stop}>
              {t('fitness.stop')}
            </Button>
          )}
        </div>
        <div className="flex-1">
          <Button block variant="soft" onClick={() => void submit()} disabled={submitDisabled}>
            {busy ? '…' : t('fitness.submit')}
          </Button>
        </div>
      </div>
      {rec.recording && (
        <p className="tb-sub mt-2" role="status">
          {t('fitness.recordingLock', {
            defaultValue: 'Recording… submit unlocks after you stop.',
          })}
        </p>
      )}
      <p className="tb-sub mt-3">{t('fitness.checkpoint')}</p>

      {(result || submitErr) && (
        <div className="mt-3">
          {result && <Note tone="info">{result}</Note>}
          {submitErr && <Note tone="error">{submitErr}</Note>}
        </div>
      )}
    </Page>
  );
}
