/** Live availability badge for restaurant rows (Home list + detail page). */

import { useTranslation } from 'react-i18next';
import { Tag } from '../../components/ui';
import { formatDistance } from '../../lib/format';
import { isLiveNearby } from './types';

export type AvailabilityBadgeProps = {
  availability: string;
  live_couriers_count?: number;
  live_modes?: string[];
  live_nearest_m?: number;
  /** `float` overlays the Home card photo; `tag` sits in the detail tag row. */
  variant?: 'float' | 'tag';
};

/**
 * One badge, two placements. The wording names runners AND bikers (never
 * "courier" for a partner), and the live treatment renders only when the
 * server reports couriers online near this restaurant right now — an empty
 * or stale backend honestly falls back to staff delivery.
 */
export function AvailabilityBadge({
  availability,
  live_couriers_count,
  live_modes,
  live_nearest_m,
  variant = 'float',
}: AvailabilityBadgeProps) {
  const { t, i18n } = useTranslation();
  if (!isLiveNearby(availability)) {
    return variant === 'float' ? (
      <span className="tb-float tb-float-calm">{t('home.staffOnly')}</span>
    ) : (
      <Tag tone="dim">{t('home.staffOnly')}</Tag>
    );
  }
  const parts: string[] = [];
  if (typeof live_couriers_count === 'number' && live_couriers_count > 0) {
    parts.push(`${live_couriers_count} ${t('track.couriers')}`);
  }
  if (typeof live_nearest_m === 'number' && Number.isFinite(live_nearest_m)) {
    parts.push(formatDistance(live_nearest_m, i18n.language));
  }
  if (Array.isArray(live_modes) && live_modes.length > 0) {
    parts.push(live_modes.join(' · '));
  }
  const label =
    parts.length > 0
      ? `${t('home.runnersBikersNearby')} · ${parts.join(' · ')}`
      : t('home.runnersBikersNearby');
  return variant === 'float' ? (
    <span className="tb-float tb-float-live" title={label} aria-label={label}>
      <span style={{ width: 12, height: 12, display: 'inline-flex' }} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
        </svg>
      </span>
      {t('home.runnersBikersNearby')}
    </span>
  ) : (
    <Tag>
      <span title={label}>{t('home.runnersBikersNearby')}</span>
    </Tag>
  );
}
