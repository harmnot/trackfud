/**
 * Saved tracks: finger-draw a loop on the pad, save it, reuse it at
 * session start. Lengths are rough estimates (pad diagonal ≈ 1 km city
 * block) — dispatch only needs the corridor hint, not survey precision.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Field, Item, List, Note, Page } from '../components/ui';
import { useTracks, type SavedTrack } from '../features/tracks/trackStore';
import type { PadPoint } from '../features/tracks/trackStore';
import { formatDistance, resolveUnits } from '../lib/format';
import i18n from '../i18n';

function TrackThumb({ track }: { track: SavedTrack }): React.JSX.Element {
  const pts = track.points.map((p) => `${p.x},${100 - p.y}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" className="tb-track-thumb" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Finger-draw pad: pointer strokes become normalized 0–100 points. */
export function TracksPage(): React.JSX.Element {
  const { t } = useTranslation();
  const tracks = useTracks((s) => s.tracks);
  const loaded = useTracks((s) => s.loaded);
  const [name, setName] = useState('');
  const [stroke, setStroke] = useState<PadPoint[]>([]);
  const [msg, setMsg] = useState('');
  const padRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);

  const locale = i18n.language === 'id' ? 'id-ID' : i18n.language === 'ms' ? 'ms-MY' : 'en-GB';
  const units = resolveUnits(locale);

  useEffect(() => {
    void useTracks.getState().load();
  }, []);

  function padPoint(ev: React.PointerEvent): PadPoint | null {
    const el = padRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const x = Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(100, ((ev.clientY - r.top) / r.height) * 100));
    return { x, y };
  }

  function polyline(): string {
    return stroke.map((p) => `${p.x},${100 - p.y}`).join(' ');
  }

  async function save(): Promise<void> {
    const saved = await useTracks.getState().save({ name, points: stroke });
    if (!saved) {
      setMsg(t('tracks.tooShort'));
      return;
    }
    setName('');
    setStroke([]);
    setMsg(t('tracks.saved'));
  }

  return (
    <Page>
      <h1 className="tb-display">{t('tracks.title')}</h1>
      <p className="tb-sub">{t('tracks.intro')}</p>
      <div
        ref={padRef}
        className="tb-drawpad mt-3"
        role="application"
        aria-label={t('tracks.draw')}
        onPointerDown={(e) => {
          drawing.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          const p = padPoint(e);
          if (p) setStroke([p]);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = padPoint(e);
          if (p) setStroke((s) => [...s.slice(-160), p]);
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
      >
        <svg viewBox="0 0 100 100" aria-hidden>
          <polyline points={polyline()} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {stroke.length === 0 && <p className="tb-sub">{t('tracks.draw')}</p>}
      </div>
      <div className="mt-2 flex gap-2">
        <div className="flex-1">
          <Field label={t('tracks.name')}>
            <input className="tb-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('tracks.namePh')} aria-label={t('tracks.name')} />
          </Field>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <div className="flex-1"><Button block variant="soft" onClick={() => setStroke([])}>{t('tracks.clear')}</Button></div>
        <div className="flex-1"><Button block variant="sun" onClick={() => void save()}>{t('tracks.save')}</Button></div>
      </div>
      {msg && <div className="mt-2"><Note tone="info">{msg}</Note></div>}
      <h2 className="tb-h2 mt-4">{t('tracks.savedList')}</h2>
      {!loaded && <p className="tb-sub">{t('common.loading')}</p>}
      <List className="flex flex-col gap-2 mt-2">
        {tracks.map((tr, i) => (
          <Item key={tr.id} index={i}>
            <div className="tb-step-row">
              <TrackThumb track={tr} />
              <span>{tr.name}<br /><small className="tb-sub">≈ {formatDistance(tr.estimateM, { locale, units })}</small></span>
              <Button variant="soft" onClick={() => void useTracks.getState().remove({ id: tr.id })}>{t('tracks.delete')}</Button>
            </div>
          </Item>
        ))}
        {loaded && tracks.length === 0 && <p className="tb-sub">{t('tracks.empty')}</p>}
      </List>
      <div className="mt-3"><Link to="/run-setup" className="tb-btn tb-btn-pine tb-btn-block">{t('tracks.use')}</Link></div>
    </Page>
  );
}
