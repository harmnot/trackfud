/** Checkout: restaurant + editable items, delivery address, wallet, quote,
 * then wallet or card pay. The 30–60 min promise shows before pay, and the
 * server quote at pay time is authoritative (the on-screen quote estimates).
 * Wallet pay creates the order idempotently (`Idempotency-Key`); Paddle opens
 * its sandbox overlay and never sees card data in this app. */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, savedUser } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { logger } from '../../lib/logger';
import { useCart } from '../../lib/store';
import { Button, Note, Page, Radio, RadioGroup, Skeleton, Tag } from '../../components/ui';
import i18n from '../../i18n';
import { getActiveId, getActiveLoc } from '../addresses/active';
import { listAddresses } from '../addresses/api';
import { fetchOrder, getWallet } from './api';
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

const TIP_PCTS = [0, 5, 10];

/** Checkout with items, address, wallet, quote, tip, and wallet/card pay. */
export function CheckoutPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const items = useCart((s) => s.items);
  const merchantId = useCart((s) => s.merchantId);
  const setQty = useCart((s) => s.setQty);
  const clear = useCart((s) => s.clear);
  const [tipPct, setTipPct] = useState(0);
  const [method, setMethod] = useState<PayMethod>('wallet');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [addressId, setAddressId] = useState<string | null>(() => getActiveId());
  const user = savedUser();
  const qc = useQueryClient();

  /** Refresh wallet + order caches after money moved server-side. */
  async function refreshMoney(): Promise<void> {
    await qc.invalidateQueries({ queryKey: ['wallet'] });
    await qc.invalidateQueries({ queryKey: ['orders'] });
  }

  const shop = useQuery({
    queryKey: ['restaurant', merchantId],
    queryFn: () => api<RestaurantDetail>(`/customer/restaurants/${merchantId}`),
    enabled: merchantId !== null,
  });

  const addresses = useQuery({
    queryKey: ['addresses'],
    queryFn: listAddresses,
    enabled: user !== null,
  });

  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: getWallet,
    enabled: user !== null,
  });

  const activeAddress = useMemo(() => {
    const list = addresses.data ?? [];
    if (list.length === 0) return null;
    return list.find((a) => a.id === addressId) ?? list.find((a) => a.is_default) ?? list[0] ?? null;
  }, [addresses.data, addressId]);

  const dropLoc = useMemo(() => {
    if (activeAddress) return { lat: activeAddress.lat, lng: activeAddress.lng };
    return getActiveLoc();
  }, [activeAddress]);

  const quote = useMemo(() => {
    if (items.length === 0) return null;
    const subtotal = items.reduce((n, i) => n + i.priceMinor * i.qty, 0);
    const currency = items[0]?.currency ?? shop.data?.currency ?? 'IDR';
    const distKm = shop.data && dropLoc
      ? haversineKm({ lat: shop.data.lat, lng: shop.data.lng }, dropLoc)
      : 2;
    return estimateQuote({ subtotalMinor: subtotal, distanceKm: distKm, currency, tipMinor: mulBps(subtotal, tipPct * 100) });
  }, [items, shop.data, dropLoc, tipPct]);

  const walletBalance = useMemo(() => {
    if (!quote) return null;
    return (wallet.data ?? []).find((w) => w.currency === quote.currency)?.balanceMinor ?? null;
  }, [wallet.data, quote]);

  const short = quote != null && walletBalance != null && walletBalance < quote.totalMinor;

  async function pay() {
    if (!merchantId || items.length === 0 || !quote) return;
    setError('');
    setBusy(true);
    const lines = items.map((i) => ({ menu_item_id: i.id, qty: i.qty }));
    try {
      if (method === 'wallet') {
        const order = activeAddress
          ? await payWithWallet({ merchantId, items: lines, addressId: activeAddress.id, tipMinor: quote.tipMinor })
          : await payWithWallet({
              merchantId,
              items: lines,
              lat: dropLoc?.lat,
              lng: dropLoc?.lng,
              note: getActiveLoc()?.note,
              tipMinor: quote.tipMinor,
            });
        clear();
        // Wallet pay deducts the total into escrow on the server; refresh
        // the cached balance so it shows the hold at once.
        await refreshMoney();
        nav(`/order/${order.id}`);
        return;
      }
      const email = user?.email;
      const base = { merchantId, items: lines, tipMinor: quote.tipMinor, email };
      const result = activeAddress
        ? await payWithCard({ ...base, addressId: activeAddress.id })
        : await payWithCard({ ...base, lat: dropLoc?.lat, lng: dropLoc?.lng, note: getActiveLoc()?.note });
      if (result.kind === 'placed') {
        logger.info('card order placed', { id: result.order.id });
        clear();
        await refreshMoney();
        nav(`/order/${result.order.id}`);
        return;
      }
      if (result.kind === 'card_authorized') {
        // The overlay closed but the Paddle webhook has not placed the order
        // yet: keep the order id so the customer can check status instead of
        // paying twice.
        logger.info('card authorized, webhook places the order', { id: result.transactionId });
        setPendingOrderId(result.orderId);
        setError(t('checkout.cardPending'));
      }
    } catch (err) {
      setError(err instanceof PayError ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  function changeRestaurant() {
    clear();
    nav('/');
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

      <section aria-label={t('checkout.restaurant')} className="tb-total mt-3">
        <p className="flex justify-between items-start gap-2">
          <span>
            <strong className="block text-lg">{shop.data?.name ?? t('common.loading')}</strong>
            {shop.data && <span className="tb-sub block">{shop.data.address}</span>}
          </span>
          {shop.data && <Tag tone="dim">~{shop.data.prep_minutes} min prep</Tag>}
        </p>
        <p className="flex gap-2 mt-2">
          <Link to={`/restaurant/${merchantId}`} className="tb-btn tb-btn-soft tb-btn-sm">{t('checkout.addMore')}</Link>
          <Button size="sm" variant="quiet" onClick={changeRestaurant}>{t('checkout.changeShop')}</Button>
        </p>
      </section>

      <section aria-label={t('checkout.items')} className="mt-3">
        <h2 className="tb-h2">{t('checkout.items')}</h2>
        <ul className="flex flex-col gap-2 mt-2">
          {items.map((i) => (
            <li key={i.id} className="tb-line-row">
              <span className="flex-1 min-w-0">
                <strong className="block truncate">{i.name}</strong>
                <span className="tb-price">{formatMoney(i.priceMinor, i.currency, i18n.language)} · {formatMoney(i.priceMinor * i.qty, i.currency, i18n.language)}</span>
              </span>
              <span className="tb-step">
                <button aria-label={t('checkout.decrease', { name: i.name })} onClick={() => setQty({ id: i.id, qty: i.qty - 1 })}>−</button>
                <strong key={i.qty}>{i.qty}</strong>
                <button aria-label={t('checkout.increase', { name: i.name })} onClick={() => setQty({ id: i.id, qty: i.qty + 1 })}>+</button>
              </span>
              <button className="tb-btn tb-btn-quiet tb-btn-sm" onClick={() => setQty({ id: i.id, qty: 0 })}>{t('checkout.remove')}</button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t('checkout.deliverTo')} className="mt-3">
        <h2 className="tb-h2">{t('checkout.deliverTo')}</h2>
        {user === null && (
          <p className="tb-sub mt-2">
            {dropLoc ? `${dropLoc.lat.toFixed(5)}, ${dropLoc.lng.toFixed(5)}` : t('checkout.noAddress')} ·{' '}
            <Link to="/location" className="underline font-bold">{t('checkout.setAddress')}</Link>
          </p>
        )}
        {user !== null && addresses.isLoading && <div className="mt-2"><Skeleton height={60} /></div>}
        {user !== null && (addresses.data ?? []).length === 0 && !addresses.isLoading && (
          <p className="tb-sub mt-2">
            {t('checkout.noAddress')} · <Link to="/location" className="underline font-bold">{t('checkout.setAddress')}</Link>
          </p>
        )}
        {user !== null && (addresses.data ?? []).length > 0 && (
          <div className="flex flex-col gap-2 mt-2" role="radiogroup" aria-label={t('checkout.deliverTo')}>
            {(addresses.data ?? []).map((a) => (
              <label key={a.id} className={`tb-addr${activeAddress?.id === a.id ? ' on' : ''}`}>
                <Radio
                  name="checkout-address"
                  value={a.id}
                  checked={activeAddress?.id === a.id}
                  ariaLabel={t('checkout.deliverTo')}
                  onChange={() => setAddressId(a.id)}
                />
                <span className="tb-addr-body">
                  <span className="tb-addr-name">{a.label}{a.is_default && <Tag>{t('location.defaultBadge')}</Tag>}</span>
                  {a.address && <span className="tb-addr-sub block">{a.address}</span>}
                  {a.note && <span className="tb-addr-sub block">{a.note}</span>}
                </span>
              </label>
            ))}
            <p className="mt-1">
              <Link to="/location" className="text-sm font-bold underline">{t('checkout.manageAddresses')}</Link>
            </p>
          </div>
        )}
      </section>

      {user !== null && (
        <section aria-label={t('checkout.wallet')} className="tb-total mt-3">
          <p className="flex justify-between items-end">
            <span className="font-bold">{t('checkout.wallet')}</span>
            <span className="tb-grand">
              {wallet.isLoading
                ? '…'
                : walletBalance == null || !quote
                  ? t('checkout.walletUnknown')
                  : formatMoney(walletBalance, quote.currency, i18n.language)}
            </span>
          </p>
          {short && (
            <p className="tb-sub mt-1">
              {t('checkout.walletShort')} <Link to="/profile" className="underline font-bold">{t('checkout.topUp')}</Link>
            </p>
          )}
        </section>
      )}

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
        <div className="mt-2">
          <RadioGroup
            name="checkout-tip"
            ariaLabel={t('checkout.tip')}
            value={String(tipPct)}
            onChange={(v) => setTipPct(Number(v))}
            options={TIP_PCTS.map((pct) => ({ value: String(pct), label: pct === 0 ? t('checkout.noTip') : `${pct}%` }))}
          />
        </div>
      </section>
      <section aria-label={t('checkout.method')} className="mt-3">
        <h2 className="tb-h2">{t('checkout.method')}</h2>
        <div className="mt-2">
          <RadioGroup
            name="checkout-method"
            ariaLabel={t('checkout.method')}
            value={method}
            onChange={(v) => setMethod(v as PayMethod)}
            options={[
              { value: 'wallet', label: t('checkout.wallet') },
              { value: 'card', label: t('checkout.card') },
            ]}
          />
        </div>
      </section>
      {error && <div className="mt-3"><Note tone="error">{error}</Note></div>}
      {pendingOrderId && (
        <div className="mt-3 flex flex-col gap-2">
          <Button
            variant="soft"
            block
            disabled={checking}
            onClick={() => void (async () => {
              setChecking(true);
              try {
                const detail = await fetchOrder({ id: pendingOrderId });
                if (detail.order.status !== 'awaiting_payment') {
                  clear();
                  await refreshMoney();
                  nav(`/order/${detail.order.id}`);
                  return;
                }
                setError(t('checkout.cardPending'));
              } catch (err) {
                setError(err instanceof Error ? err.message : t('common.error'));
              } finally {
                setChecking(false);
              }
            })()}
          >
            {checking ? '…' : t('checkout.checkStatus')}
          </Button>
        </div>
      )}
      <div className="mt-3"><Note tone="info">{t('checkout.pinNote')}</Note></div>
      <div className="mt-3 flex flex-col gap-2">
        <Button variant="ember" block disabled={busy || !quote || (method === 'wallet' && short)} onClick={() => void pay()}>
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
