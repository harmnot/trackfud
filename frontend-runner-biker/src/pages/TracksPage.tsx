/**
 * Saved tracks: finger-draw a loop on the pad, anchor it on Google Maps
 * (Strava-art style), snap it to real roads, save it, reuse it at session
 * start. The pad sketch stays device-independent (0–100); the saved geo
 * is the projected loop plus the snapped road route when routing succeeds.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Field, Item, List, Note, Page, RadioGroup, TextInput } from '../components/ui';
import { useTracks, type PadPoint, type SavedTrack } from '../features/tracks/trackStore';
import { TrackMap } from '../features/tracks/TrackMap';
import {
  buildMapsDirUrl,
  downsamplePath,
  geoLengthM,
  sketchToLatLng,
  type TravelMode,
} from '../features/tracks/sketchToGeo';
import { snapSketchToRoads } from '../features/tracks/snapRoute';
import type { LatLng } from '../lib/maps';
import { formatDistance, resolveUnits, type Units } from '../lib/format';
import { logger } from '../lib/logger';
import i18n from '../i18n';

const LOOP_SIZES = [500, 1000, 2000];

function TrackThumb({ track }: { track: SavedTrack }): React.JSX.Element {
  const pts = track.points.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" className="tb-track-thumb" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Saved-track distance: snapped road length first, then sketch, then the rough estimate. */
function trackDistanceM(track: SavedTrack): number {
  if (track.geo?.snapped && track.geo.snapped.length >= 2) return geoLengthM(track.geo.snapped);
  if (track.geo?.path && track.geo.path.length >= 2) return geoLengthM(track.geo.path);
  return track.estimateM;
}

/** One saved track with an expandable live map preview. */
function TrackCard(args: {
  track: SavedTrack;
  open: boolean;
  onToggle: () => void;
  locale: string;
  units: Units;
}): React.JSX.Element {
  const { track, open, onToggle, locale, units } = args;
  const { t } = useTranslation();
  const mapsUrl = track.geo
    ? buildMapsDirUrl({
        path: track.geo.snapped && track.geo.snapped.length >= 2 ? track.geo.snapped : track.geo.path,
        travelMode: track.geo.travelMode,
      })
    : null;
  return (
    <div className="tb-card">
      <div className="tb-step-row">
        <TrackThumb track={track} />
        <span>{track.name}<br /><small className="tb-sub">≈ {formatDistance(trackDistanceM(track), { locale, units })}{track.geo?.snapped ? ` · ${t('tracks.roadLen')}` : ''}</small></span>
        <span className="flex gap-2">
          {track.geo && (
            <Button variant="soft" onClick={onToggle}>{open ? t('tracks.hide') : t('tracks.preview')}</Button>
          )}
          <Button variant="soft" onClick={() => void useTracks.getState().remove({ id: track.id })}>{t('tracks.delete')}</Button>
        </span>
      </div>
      {open && track.geo && (
        <div className="mt-2 flex flex-col gap-2">
          <TrackMap center={track.geo.center} sketch={track.geo.path} snapped={track.geo.snapped} />
          {mapsUrl && (
            <a className="tb-btn tb-btn-soft tb-btn-block" href={mapsUrl} target="_blank" rel="noreferrer">
              {t('tracks.openMaps')}
            </a>
          )}
        </div>
      )}
    </div>
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
  const [center, setCenter] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [locErr, setLocErr] = useState('');
  const [spanM, setSpanM] = useState(1000);
  const [travelMode, setTravelMode] = useState<TravelMode>('walking');
  // Pad width ÷ height: the projection keeps meters-per-pixel equal on both
  // axes, so a drawn circle stays a circle on the map on any screen size.
  const [aspect, setAspect] = useState(1);
  const [snapped, setSnapped] = useState<LatLng[] | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [snapMsg, setSnapMsg] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);

  const locale = i18n.language === 'id' ? 'id-ID' : i18n.language === 'ms' ? 'ms-MY' : 'en-GB';
  const units = resolveUnits(locale);

  useEffect(() => {
    void useTracks.getState().load();
  }, []);

  useEffect(() => {
    const el = padRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setAspect(r.width / r.height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** A re-snapped or moved sketch invalidates the old road route. */
  useEffect(() => {
    setSnapped(null);
    setSnapMsg('');
  }, [stroke, center, spanM, travelMode]);

  const geoPath = useMemo(() => {
    if (!center || stroke.length < 2) return [];
    return sketchToLatLng({ points: stroke, center, spanM, aspect });
  }, [stroke, center, spanM, aspect]);

  const sketchLenM = geoPath.length >= 2 ? geoLengthM(geoPath) : 0;
  const previewUrl = geoPath.length >= 2 ? buildMapsDirUrl({ path: snapped ?? geoPath, travelMode }) : null;

  /** Pointer → pad point using the pad's own box (never the SVG child). */
  function padPoint(clientX: number, clientY: number, el: HTMLDivElement): PadPoint | null {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const x = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(100, ((clientY - r.top) / r.height) * 100));
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  }

  /** All points in this pointer event (coalesced when the browser offers them). */
  function eventPoints(ev: React.PointerEvent<HTMLDivElement>): PadPoint[] {
    const el = ev.currentTarget;
    const native = ev.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const raw = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [native];
    const out: PadPoint[] = [];
    for (const e of raw.length > 0 ? raw : [native]) {
      const p = padPoint(e.clientX, e.clientY, el);
      if (p) out.push(p);
    }
    return out;
  }

  function polyline(): string {
    return stroke.map((p) => `${p.x},${p.y}`).join(' ');
  }

  function endStroke(): void {
    drawing.current = false;
  }

  function useMyLocation(): void {
    if (!('geolocation' in navigator)) {
      setLocErr(t('tracks.locationFailed'));
      return;
    }
    setLocating(true);
    setLocErr('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        logger.warn('track anchor geolocation failed', err);
        setLocErr(t('tracks.locationFailed'));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function snap(): Promise<void> {
    if (geoPath.length < 2 || snapping) return;
    setSnapping(true);
    setSnapMsg('');
    const res = await snapSketchToRoads({ path: geoPath, travelMode });
    setSnapped(res);
    setSnapMsg(res ? t('tracks.snappedOk') : t('tracks.snapFailed'));
    setSnapping(false);
  }

  async function save(): Promise<void> {
    const geo =
      center && geoPath.length >= 3
        ? {
            center,
            spanM,
            aspect,
            path: downsamplePath({ path: geoPath, max: 64 }),
            snapped,
            travelMode,
          }
        : undefined;
    const saved = await useTracks.getState().save({ name, points: stroke, geo });
    if (!saved) {
      setMsg(t('tracks.tooShort'));
      return;
    }
    setName('');
    setStroke([]);
    setSnapped(null);
    setSnapMsg('');
    setMsg(geo ? t('tracks.savedWithMap') : t('tracks.saved'));
  }

  return (
    <Page>
      <h1 className="tb-display">{t('tracks.title')}</h1>
      <p className="tb-sub">{t('tracks.intro')}</p>

      <h2 className="tb-h2 mt-4">{t('tracks.drawTitle')}</h2>
      <div
        ref={padRef}
        className="tb-drawpad mt-2"
        role="application"
        aria-label={t('tracks.draw')}
        onPointerDown={(e) => {
          e.preventDefault();
          drawing.current = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Older browsers: the stroke still tracks while the pointer is over the pad.
          }
          const pts = eventPoints(e);
          if (pts.length > 0) setStroke(pts);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          e.preventDefault();
          const pts = eventPoints(e);
          if (pts.length === 0) return;
          setStroke((s) => [...s, ...pts].slice(-400));
        }}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onLostPointerCapture={endStroke}
        onPointerLeave={() => {
          if (drawing.current) endStroke();
        }}
      >
        <svg viewBox="0 0 100 100" aria-hidden preserveAspectRatio="none">
          <polyline points={polyline()} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {stroke.length === 0 && <p className="tb-sub">{t('tracks.draw')}</p>}
      </div>
      <div className="mt-2">
        <Button block variant="soft" onClick={() => setStroke([])}>{t('tracks.clear')}</Button>
      </div>

      <div className="tb-card mt-3">
        <p className="text-sm font-bold">{t('tracks.mapTitle')}</p>
        <p className="tb-sub mt-1">{t('tracks.mapIntro')}</p>
        <div className="mt-2">
          <Button block variant="soft" onClick={useMyLocation} disabled={locating}>
            {locating ? t('tracks.locating') : t('tracks.useMyLocation')}
          </Button>
        </div>
        {center && (
          <p className="tb-sub mt-1">
            {t('tracks.locatedAt', { lat: center.lat.toFixed(5), lng: center.lng.toFixed(5) })}
          </p>
        )}
        {locErr !== '' && <div className="mt-2"><Note tone="error">{locErr}</Note></div>}
        <div className="mt-2">
          <RadioGroup
            name="loop-size"
            label={t('tracks.loopSize')}
            value={String(spanM)}
            onChange={(v) => setSpanM(Number(v))}
            options={LOOP_SIZES.map((m) => ({
              value: String(m),
              label: m >= 1000 ? `${m / 1000} km` : `${m} m`,
            }))}
          />
        </div>
        <div className="mt-2">
          <RadioGroup
            name="travel-mode"
            label={t('tracks.travel')}
            value={travelMode}
            onChange={(v) => setTravelMode(v as TravelMode)}
            options={[
              { value: 'walking', label: t('tracks.travelWalk') },
              { value: 'bicycling', label: t('tracks.travelBike') },
            ]}
          />
        </div>
        <div className="mt-2 flex gap-2">
          <div className="flex-1">
            <Button
              block
              variant="ink"
              onClick={() => void snap()}
              disabled={geoPath.length < 2 || snapping || !center}
            >
              {snapping ? t('tracks.snapping') : t('tracks.snapRoads')}
            </Button>
          </div>
        </div>
        {!center && <p className="tb-sub mt-1">{t('tracks.needCenter')}</p>}
        {center && geoPath.length < 2 && <p className="tb-sub mt-1">{t('tracks.needSketch')}</p>}
        {snapMsg !== '' && <div className="mt-2"><Note tone={snapped ? 'info' : 'error'}>{snapMsg}</Note></div>}
        {sketchLenM > 0 && (
          <p className="tb-sub mt-1">
            {t('tracks.sketchLen', { dist: formatDistance(sketchLenM, { locale, units }) })}
            {snapped ? ` · ${t('tracks.roadLen')}: ${formatDistance(geoLengthM(snapped), { locale, units })}` : ''}
          </p>
        )}
      </div>

      {center && geoPath.length >= 2 && (
        <div className="mt-3 flex flex-col gap-2">
          <TrackMap center={center} sketch={geoPath} snapped={snapped} />
          {previewUrl && (
            <a className="tb-btn tb-btn-soft tb-btn-block" href={previewUrl} target="_blank" rel="noreferrer">
              {t('tracks.openMaps')}
            </a>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <div className="flex-1">
          <Field label={t('tracks.name')}>
            <TextInput value={name} onChange={setName} placeholder={t('tracks.namePh')} aria-label={t('tracks.name')} />
          </Field>
        </div>
      </div>
      <div className="mt-2">
        <Button block variant="sun" onClick={() => void save()}>{t('tracks.save')}</Button>
      </div>
      {msg && <div className="mt-2"><Note tone="info">{msg}</Note></div>}

      <h2 className="tb-h2 mt-4">{t('tracks.savedList')}</h2>
      {!loaded && <p className="tb-sub">{t('common.loading')}</p>}
      <List className="flex flex-col gap-2 mt-2">
        {tracks.map((tr, i) => (
          <Item key={tr.id} index={i}>
            <TrackCard
              track={tr}
              open={openId === tr.id}
              onToggle={() => setOpenId((cur) => (cur === tr.id ? null : tr.id))}
              locale={locale}
              units={units}
            />
          </Item>
        ))}
        {loaded && tracks.length === 0 && <p className="tb-sub">{t('tracks.empty')}</p>}
      </List>
      <div className="mt-3"><Link to="/run-setup" className="tb-btn tb-btn-pine tb-btn-block">{t('tracks.use')}</Link></div>
    </Page>
  );
}
