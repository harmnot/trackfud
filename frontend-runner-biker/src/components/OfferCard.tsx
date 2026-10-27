/** Incoming dispatch offer: big ACCEPT/DECLINE, 30 s timer, track fit. */
import { OFFER_WINDOW_S, formatDistance, formatMoney } from '../lib/format';
import type { Offer } from '../features/offers/types';
import { Button } from './ui';

type Props = {
  offer: Offer;
  secondsLeft: number;
  locale: string;
  units: 'km' | 'mi';
  acceptLabel: string;
  declineLabel: string;
  expiryLabel: (s: number) => string;
  fitLabel: (offTrack: string, adds: string) => string;
  noPenalty: string;
  demoLabel: string;
  onAccept: () => void;
  onDecline: () => void;
};

/** Offer card overlay. Timer is informative only — no rush while moving. */
export function OfferCard(props: Props) {
  return (
    <section className="tb-offer" role="alertdialog" aria-label={props.offer.merchantName} aria-live="assertive">
      <div className="tb-offer-top">
        <span className="tb-badge">{props.offer.mode === 'biker' ? '🚲' : '🏃'} {props.offer.merchantName}</span>
        {props.offer.demo && <span className="tb-badge tb-badge-sun">{props.demoLabel}</span>}
      </div>
      <p className="tb-offer-fee">
        {formatMoney(props.offer.feeMinor, props.offer.currency, props.locale)}
      </p>
      <p className="tb-offer-fit">
        {props.fitLabel(
          formatDistance(props.offer.offTrackM, { locale: props.locale, units: props.units }),
          formatDistance(props.offer.addsM, { locale: props.locale, units: props.units }),
        )}
      </p>
      <p className="tb-offer-meta">
        {props.offer.sizeClass} · {props.offer.spillRisk} spill · 30–60 min promise
      </p>
      <progress
        className="tb-offer-timer"
        max={OFFER_WINDOW_S}
        value={props.secondsLeft}
        aria-label={props.expiryLabel(props.secondsLeft)}
      />
      <p className="tb-offer-count">{props.expiryLabel(props.secondsLeft)}</p>
      <div className="tb-offer-actions">
        <Button variant="sun" block onClick={props.onAccept}>
          <span aria-hidden>✓</span> {props.acceptLabel}
        </Button>
        <Button variant="soft" block onClick={props.onDecline}>
          {props.declineLabel}
        </Button>
      </div>
      <p className="tb-sub">{props.noPenalty}</p>
    </section>
  );
}
