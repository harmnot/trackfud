/** Combined courier + restaurant ratings (stars + courier tags).
 * The server keeps one rating row per order, so both sides submit together
 * in a single `POST .../ratings` call. Courier ratings never blame the
 * courier for the food and vice versa. */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import { Button, Note, Skeleton } from '../../components/ui';
import { useRating, useSubmitRatings } from './hooks';
import { COURIER_TAGS, STAR_VALUES, type Stars } from './types';

function StarsInput(args: { value: Stars | 0; onPick: (s: Stars) => void; label: string }) {
  return (
    <div className="tb-stars" role="radiogroup" aria-label={args.label}>
      {STAR_VALUES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={args.value === s}
          aria-label={`${s} / 5`}
          className={s <= args.value ? 'on' : ''}
          onClick={() => args.onPick(s)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

/** Combined rating form: courier stars + tags and restaurant stars, one submit. */
export function RatingsSection(args: { orderId: string }) {
  const { t } = useTranslation();
  const courierSaved = useRating({ orderId: args.orderId, target: 'courier' });
  const restaurantSaved = useRating({ orderId: args.orderId, target: 'restaurant' });
  const submit = useSubmitRatings({ orderId: args.orderId });
  const [courierStars, setCourierStars] = useState<Stars | 0>(0);
  const [restaurantStars, setRestaurantStars] = useState<Stars | 0>(0);
  const [tags, setTags] = useState<string[]>([]);
  const [err, setErr] = useState('');

  if (courierSaved.isLoading || restaurantSaved.isLoading) {
    return <div className="mt-3"><Skeleton height={150} /></div>;
  }
  if (courierSaved.data || restaurantSaved.data) {
    return (
      <section className="tb-total mt-3" aria-label={t('rate.doneTitle')}>
        <p className="font-bold">{t('rate.doneTitle')}</p>
        {courierSaved.data && (
          <p className="tb-sub" aria-live="polite">
            {t('rate.done_courier')}: {'★'.repeat(courierSaved.data.stars)}{'☆'.repeat(5 - courierSaved.data.stars)}
          </p>
        )}
        {restaurantSaved.data && (
          <p className="tb-sub" aria-live="polite">
            {t('rate.done_restaurant')}: {'★'.repeat(restaurantSaved.data.stars)}{'☆'.repeat(5 - restaurantSaved.data.stars)}
          </p>
        )}
      </section>
    );
  }

  function toggle(tag: string) {
    setTags((cur) => (cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag]));
  }

  async function send() {
    setErr('');
    try {
      await submit.mutateAsync({
        courierStars: courierStars === 0 ? null : courierStars,
        courierTags: tags,
        restaurantStars: restaurantStars === 0 ? null : restaurantStars,
      });
    } catch (e) {
      setErr(e instanceof ApiError || e instanceof Error ? e.message : t('common.error'));
    }
  }

  const ready = courierStars !== 0 || restaurantStars !== 0;
  return (
    <section className="tb-total mt-3" aria-label={t('rate.title')}>
      <h2 className="tb-h2">{t('rate.title')}</h2>
      <p className="tb-sub">{t('rate.sub_courier')}</p>
      <div className="mt-2">
        <StarsInput value={courierStars} onPick={setCourierStars} label={t('rate.title_courier')} />
      </div>
      <div className="tb-chips mt-2" aria-label={t('rate.tags')}>
        {COURIER_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            aria-pressed={tags.includes(tag)}
            className={`tb-chip${tags.includes(tag) ? ' on' : ''}`}
            onClick={() => toggle(tag)}
          >
            {t(`rate.tag_${tag}`)}
          </button>
        ))}
      </div>
      <h3 className="tb-h2 mt-3">{t('rate.title_restaurant')}</h3>
      <p className="tb-sub">{t('rate.sub_restaurant')}</p>
      <div className="mt-2">
        <StarsInput value={restaurantStars} onPick={setRestaurantStars} label={t('rate.title_restaurant')} />
      </div>
      {err && <div className="mt-2"><Note tone="error">{err}</Note></div>}
      <div className="mt-2">
        <Button variant="ember" block disabled={!ready || submit.isPending} onClick={() => void send()}>
          {submit.isPending ? '…' : t('rate.send')}
        </Button>
      </div>
    </section>
  );
}
