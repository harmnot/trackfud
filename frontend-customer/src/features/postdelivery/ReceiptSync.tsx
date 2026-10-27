/** Email-receipt view: the same receipt the server emails (Brevo) on
 * delivery, rendered from server totals. Plus the sync badge showing
 * online/offline + pending-sync backlog with manual resend. */

import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../lib/format';
import { Button, Note } from '../../components/ui';
import i18n from '../../i18n';
import type { OrderDetail } from '../orders/types';
import { buildReceipt } from './api';
import { useSync } from './hooks';

/** Receipt card: line items, fees, total, payment + refund state. */
export function ReceiptCard(args: { detail: OrderDetail; restaurant: string }) {
  const { t } = useTranslation();
  const r = buildReceipt({ detail: args.detail, restaurant: args.restaurant });
  const at = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(r.createdAt));
  return (
    <section className="tb-total mt-3" aria-label={t('receipt.title')}>
      <h2 className="tb-h2">{t('receipt.title')}</h2>
      <p className="tb-sub">{r.restaurant} · {at}</p>
      <p className="tb-sub">{t('track.orderCode').replace('{code}', r.code)} · {t('receipt.via').replace('{method}', r.paymentMethod)}</p>
      <div className="mt-2 flex flex-col gap-1">
        {r.lines.map((l, i) => (
          <p className="tb-row" key={i}>
            <span>{l.qty}× {l.name}</span>
            <span>{formatMoney(l.totalMinor, r.currency, i18n.language)}</span>
          </p>
        ))}
      </div>
      <div className="mt-2">
        <p className="tb-row"><span>{t('checkout.food')}</span><span>{formatMoney(r.subtotalMinor, r.currency, i18n.language)}</span></p>
        <p className="tb-row"><span>{t('checkout.delivery')}</span><span>{formatMoney(r.deliveryMinor, r.currency, i18n.language)}</span></p>
        <p className="tb-row"><span>{t('checkout.service')}</span><span>{formatMoney(r.serviceMinor, r.currency, i18n.language)}</span></p>
        <p className="tb-row"><span>{t('checkout.tip')}</span><span>{formatMoney(r.tipMinor, r.currency, i18n.language)}</span></p>
        <p className="flex justify-between items-end mt-2">
          <span className="font-bold">{t('checkout.total')}</span>
          <span className="tb-grand">{formatMoney(r.totalMinor, r.currency, i18n.language)}</span>
        </p>
      </div>
      {r.refunded && <div className="mt-2"><Note tone="info">{t('track.refundedNote')}</Note></div>}
      <p className="tb-sub mt-2">{t('receipt.emailed')}</p>
    </section>
  );
}

/** Connectivity + backlog badge for the app shell. */
export function SyncBadge() {
  const { t } = useTranslation();
  const sync = useSync();
  if (sync.online && sync.pending === 0) return null;
  return (
    <p className="tb-offline" role="status">
      {!sync.online
        ? t('profile.offline')
        : t('sync.pending').replace('{n}', String(sync.pending))}
      {sync.online && sync.pending > 0 && (
        <span>
          {' '}
          <button
            type="button"
            className="underline font-bold"
            disabled={sync.flushing}
            onClick={() => sync.resend()}
          >
            {sync.flushing ? '…' : t('sync.resend')}
          </button>
        </span>
      )}
    </p>
  );
}

/** Small pending-sync hint for inline use inside post-delivery sections. */
export function PendingHint() {
  const { t } = useTranslation();
  const sync = useSync();
  if (sync.online && sync.pending === 0) return null;
  return (
    <div className="mt-2">
      <Button variant="quiet" size="sm" disabled={sync.flushing || !sync.online} onClick={() => sync.resend()}>
        {sync.online ? t('sync.pending').replace('{n}', String(sync.pending)) : t('profile.offline')}
      </Button>
    </div>
  );
}
