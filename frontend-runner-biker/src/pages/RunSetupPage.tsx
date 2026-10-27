/** Session start: run/ride, goal, track kind. AI track is a placeholder. */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Button, Dropdown, Field, Note, Page } from '../components/ui';
import { unlockAudio } from '../lib/notify';
import { useRun } from '../features/run/sessionStore';
import { useStaff } from '../features/staff/staffStore';
import { useTracks } from '../features/tracks/trackStore';
import type { GoalKind, TrackKind } from '../features/run/types';
import type { CourierMode } from '../lib/format';

const DIST_GOALS = [3000, 5000, 10000];
const TIME_GOALS = [1800, 2700, 3600];

export function RunSetupPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const start = useRun((s) => s.start);
  const [mode, setMode] = useState<CourierMode>('runner');
  const [goalKind, setGoalKind] = useState<GoalKind>('distance');
  const [goalValue, setGoalValue] = useState(5000);
  const [trackKind, setTrackKind] = useState<TrackKind>('free');
  const [trackName, setTrackName] = useState<string | null>(null);
  const staffActive = useStaff((s) => s.active);
  const tracks = useTracks((s) => s.tracks);
  useEffect(() => {
    void useTracks.getState().load();
  }, []);
  const [currency, setCurrency] = useState(() => {
    try {
      return localStorage.getItem('tb:courier:currency') ?? 'IDR';
    } catch {
      return 'IDR';
    }
  });

  function begin(): void {
    try {
      localStorage.setItem('tb:courier:currency', currency);
    } catch {
      /* demo pref only */
    }
    unlockAudio();
    start({ setup: { mode, goalKind, goalValue: goalKind === 'open' ? 0 : goalValue, trackKind, trackName: trackKind === 'saved' ? trackName : null } });
    nav('/run');
  }

  const goalOptions =
    goalKind === 'time'
      ? TIME_GOALS.map((s) => ({ value: String(s), label: `${s / 60} min` }))
      : DIST_GOALS.map((m) => ({ value: String(m), label: `${m / 1000} km` }));

  return (
    <Page>
      <h1 className="tb-display">{t('run.setupTitle')}</h1>
      <p className="tb-sub">{t('app.safety')}</p>
      <div className="tb-modes mt-3" role="radiogroup" aria-label={t('onboard.mode')}>
        <label className="tb-mode">
          <input type="radio" name="rmode" checked={mode === 'runner'} onChange={() => setMode('runner')} />
          <span className="tb-mode-card"><span>{t('onboard.runner')}</span></span>
        </label>
        <label className="tb-mode">
          <input type="radio" name="rmode" checked={mode === 'biker'} onChange={() => setMode('biker')} />
          <span className="tb-mode-card"><span>{t('onboard.biker')}</span></span>
        </label>
      </div>
      <div className="mt-3 flex flex-col gap-3">
        <Field label={t('run.goal')}>
          <Dropdown
            label={t('run.goal')}
            full
            value={goalKind}
            options={[
              { value: 'distance', label: t('run.goalDistance') },
              { value: 'time', label: t('run.goalTime') },
              { value: 'open', label: t('run.goalOpen') },
            ]}
            onChange={(v) => setGoalKind(v as GoalKind)}
          />
        </Field>
        {goalKind !== 'open' && (
          <Field label={t('run.target')}>
            <Dropdown
              label={t('run.target')}
              full
              value={String(goalValue)}
              options={goalOptions}
              onChange={(v) => setGoalValue(Number(v))}
            />
          </Field>
        )}
        <Field label={t('run.track')}>
          <Dropdown
            label={t('run.track')}
            full
            value={trackKind}
            options={[
              { value: 'free', label: t('run.trackFree') },
              { value: 'saved', label: t('run.trackSaved') },
              { value: 'ai', label: t('run.trackAi') },
            ]}
            onChange={(v) => setTrackKind(v as TrackKind)}
          />
        </Field>
        {trackKind === 'ai' && <Note tone="info">{t('run.trackAiSoon')}</Note>}
        {trackKind === 'saved' && (
          <Field label={t('tracks.pick')}>
            <Dropdown
              label={t('tracks.pick')}
              full
              value={trackName ?? ''}
              options={[
                { value: '', label: t('tracks.none') },
                ...tracks.map((tr) => ({ value: tr.name, label: tr.name })),
              ]}
              onChange={setTrackName}
            />
          </Field>
        )}
        {trackKind === 'saved' && tracks.length === 0 && (
          <Note tone="info">{t('tracks.emptyShort')} <Link to="/tracks" className="underline">{t('tracks.title')}</Link></Note>
        )}
        {staffActive && <Note tone="info">{t('staff.onDutyShort')}</Note>}
        <Field label={t('run.currency')}>
          <Dropdown
            label={t('run.currency')}
            full
            value={currency}
            options={[
              { value: 'IDR', label: 'IDR · Rupiah' },
              { value: 'GBP', label: 'GBP · Pound' },
            ]}
            onChange={setCurrency}
          />
        </Field>
      </div>
      <div className="mt-4">
        <Button block variant="sun" onClick={begin}>{t('run.start')}</Button>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <Link to="/staff" className="tb-btn tb-btn-soft tb-btn-block">{t('staff.title')}</Link>
        <Link to="/tracks" className="tb-btn tb-btn-soft tb-btn-block">{t('tracks.title')}</Link>
        <Link to="/chat" className="tb-btn tb-btn-soft tb-btn-block">{t('chat.title')}</Link>
        <Link to="/ratings" className="tb-btn tb-btn-soft tb-btn-block">{t('ratings.title')}</Link>
      </div>
    </Page>
  );
}
