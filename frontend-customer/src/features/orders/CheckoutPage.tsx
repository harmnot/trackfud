/** Checkout: quote with the 30–60 min promise before pay, then wallet or card pay.
 * Wallet pay creates the order idempotently (`Idempotency-Key`); Paddle opens
 * its sandbox overlay and never sees card data in this app. */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, savedUser } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { logger } from '../../lib/logger';
import { useCart } from '../../lib/store';
import { Button, Note, Page, Skeleton } from '../../components/ui';
import i18n from '../../i18n';
import { estimateQuote, haversineKm, mulBps } from './quote';
import { PayError, payWithCard, payWithWallet, type PayMethod } from './pay';

type RestaurantDetail = {
  id: string;
  name: string;
  currency: string;
  address: string;
  prep_minutes: number;
  lat: number;
  lng: number;
};

type SavedLoc = { lat: number; lng: number; note?: string } | null;

function savedLoc(): SavedLoc {
  try {
    return JSON.parse(localStorage.getItem('tb:customer:loc') ?? 'null') as SavedLoc;
  } catch {
    return null;
  }
}

const TIP_PCTS = [0, 5, 10];

/** Checkout with quote, promise, tip, and wallet/card pay. */
export function CheckoutPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const items = useCart((s) => s.items);
  const merchantId = useCart((s) => s.merchantId);
  const clear = useCart((s) => s.clear);
  const [tipPct, setTipPct] = useState(0);
  const [method, setMethod] = useState<PayMethod>('wallet');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const shop = useQuery({
    queryKey: ['restaurant', merchantId],
    queryFn: () => api<RestaurantDetail>(`/customer/restaurants/${merchantId}`),
    enabled: merchantId !== null,
  });

  const quote = useMemo(() => {
    if (items.length === 0) return null;
    const subtotal = items.reduce((n, i) => n + i.priceMinor * i.qty, 0);
    const currency = items[0]?.currency ?? 'IDR';
    const loc = savedLoc();
    const distKm = shop.data && loc
      ? haversineKm({ lat: shop.data.lat, lng: shop.data.lng }, loc)
      : 2;
    return estimateQuote({ subtotalMinor: subtotal, distanceKm: distKm, currency, tipMinor: mulBps(subtotal, tipPct * 100) });
  }, [items, shop.data, tipPct]);

  async function pay() {
    if (!merchantId || items.length === 0 || !quote) return;
    setError('');
    setBusy(true);
    try {
      if (method === 'wallet') {
        const loc = savedLoc();
        const order = await payWithWallet({
          merchantId,
          items: items.map((i) => ({ menu_item_id: i.id, qty: i.qty })),
          lat: loc?.lat,
          lng: loc?.lng,
          note: loc?.note,
          tipMinor: quote.tipMinor,
        });
        clear();
        nav(`/order/${order.id}`);
        return;
      }
      const user = savedUser();
      const loc = savedLoc();
      const result = await payWithCard({
        merchantId,
        items: items.map((i) => ({ menu_item_id: i.id, qty: i.qty })),
        lat: loc?.lat,
        lng: loc?.lng,
        note: loc?.note,
        tipMinor: quote.tipMinor,
        email: user?.email,
      });
      if (result.kind === 'placed') {
        logger.info('card order placed', { id: result.order.id });
        clear();
        nav(`/order/${result.order.id}`);
        return;
      }
      if (result.kind === 'card_authorized') {
        logger.info('card authorized, webhook places the order', { id: result.transactionId });
        setError(t('checkout.cardPending'));
      }
    } catch (err) {
      setError(err instanceof PayError ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0 || merchantId === null) {
    return (
      <Page>
        <h1 className="tb-display">{t('checkout.title')}</h1>
        <p className="tb-sub">{t('cart.empty')}</p>
        <p className="mt-3"><Link to="/" className="tb-btn tb-btn-ember tb-btn-sm">{t('nav.home')}</Link></p>
      </Page>
    );
  }

  return (
    <Page>
      <h1 className="tb-display">{t('checkout.title')}</h1>
      <p className="tb-promise" role="note">{t('checkout.promise')}</p>
      {shop.isLoading && <div className="mt-3"><Skeleton height={60} /></div>}
      {quote && (
        <section className="tb-total mt-3" aria-label={t('checkout.quote')}>
          <Row label={t('checkout.food')} value={formatMoney(quote.subtotalMinor, quote.currency, i18n.language)} />
          <Row label={t('checkout.delivery')} value={formatMoney(quote.deliveryMinor, quote.currency, i18n.language)} />
          <Row label={t('checkout.service')} value={formatMoney(quote.serviceMinor, quote.currency, i18n.language)} />
          <Row label={t('checkout.tip')} value={formatMoney(quote.tipMinor, quote.currency, i18n.language)} />
          <p className="flex justify-between items-end mt-2">
            <span className="font-bold">{t('checkout.total')}</span>
            <span className="tb-grand">{formatMoney(quote.totalMinor, quote.currency, i18n.language)}</span>
          </p>
          <p className="tb-est">{t('checkout.estimateNote')}</p>
        </section>
      )}
      <section aria-label={t('checkout.tip')} className="mt-3">
        <h2 className="tb-h2">{t('checkout.tip')}</h2>
        <div className="tb-chips mt-2" role="radiogroup" aria-label={t('checkout.tip')}>
          {TIP_PCTS.map((pct) => (
            <button
              key={pct}
              role="radio"
              aria-checked={tipPct === pct}
              className={`tb-chip${tipPct === pct ? ' on' : ''}`}
              onClick={() => setTipPct(pct)}
            >
              {pct === 0 ? t('checkout.noTip') : `${pct}%`}
            </button>
          ))}
        </div>
      </section>
      <section aria-label={t('checkout.method')} className="mt-3">
        <h2 className="tb-h2">{t('checkout.method')}</h2>
        <div className="tb-chips mt-2" role="radiogroup" aria-label={t('checkout.method')}>
          <button role="radio" aria-checked={method === 'wallet'} className={`tb-chip${method === 'wallet' ? ' on' : ''}`} onClick={() => setMethod('wallet')}>
            {t('checkout.wallet')}
          </button>
          <button role="radio" aria-checked={method === 'card'} className={`tb-chip${method === 'card' ? ' on' : ''}`} onClick={() => setMethod('card')}>
            {t('checkout.card')}
          </button>
        </div>
      </section>
      {error && <div className="mt-3"><Note tone="error">{error}</Note></div>}
      <div className="mt-3 flex flex-col gap-2">
        <Button variant="ember" block disabled={busy || !quote} onClick={() => void pay()}>
          {busy ? '…' : t('checkout.payNow')}
        </Button>
        <Link to="/cart" className="tb-btn tb-btn-soft tb-btn-block">{t('checkout.back')}</Link>
      </div>
    </Page>
  );
}

function Row(args: { label: string; value: string }) {
  return (
    <p className="tb-row">
      <span>{args.label}</span>
      <span>{args.value}</span>
    </p>
  );
}
