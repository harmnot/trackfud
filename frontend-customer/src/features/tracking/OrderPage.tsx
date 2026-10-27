/** Live order tracking: status timeline, LiveMap, courier card, customer PIN.
 * Push + WS `order.status` updates invalidate the order query; the page never
 * reloads mid-order. Courier GPS arrives with the B4 feed; until then the
 * marker animates between status waypoints. */

import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { formatMoney, unitFor } from '../../lib/format';
import { Button, Note, Page, Skeleton } from '../../components/ui';
import i18n from '../../i18n';
import { cancelOrder, listOrders } from '../orders/api';
import { useOrder } from '../orders/hooks';
import { useLiveOrderStatus } from '../orders/live';
import { toCourierInfo, type OrderStatus } from '../orders/types';
import { ChatPanel } from '../postdelivery/ChatPanel';
import { CheerPanel } from '../postdelivery/CheerPanel';
import { ImpactCard } from '../postdelivery/ImpactCard';
import { NoCourierPanel } from '../postdelivery/NoCourierPanel';
import { PinHandover } from '../postdelivery/PinHandover';
import { RatingsSection } from '../postdelivery/RatingForms';
import { ReceiptCard } from '../postdelivery/ReceiptSync';
import { CourierCard } from './CourierCard';
import { LiveMap } from './LiveMap';
import { StatusTimeline } from './StatusTimeline';

/** Route progress fraction derived from the latest known order status. */
function progressFor(status: OrderStatus): number {
  switch (status) {
    case 'awaiting_payment': return 0.02;
    case 'placed': return 0.08;
    case 'accepted': return 0.2;
    case 'ready': return 0.45;
    case 'picked_up': return 0.7;
    case 'delivered':
    case 'completed': return 1;
    case 'rejected':
    case 'cancelled': return 0;
  }
}

function etaText(args: { windowEnd: string | null; readyAt: string | null; t: (k: string) => string }): string {
  const fmt = (iso: string) => new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  if (args.windowEnd) return args.t('track.etaWindow').replace('{time}', fmt(args.windowEnd));
  if (args.readyAt) return args.t('track.etaReady').replace('{time}', fmt(args.readyAt));
  return args.t('track.etaSoon');
}

/** Live tracking page for one order. */
export function OrderPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const orderId = id ?? '';
  const detail = useOrder({ id: orderId });
  useLiveOrderStatus({ orderId });
  const [cancelMsg, setCancelMsg] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const shop = useQuery({
    queryKey: ['restaurant', detail.data?.order.merchant_id],
    queryFn: () => api<{ name: string; lat: number; lng: number }>(
      `/customer/restaurants/${detail.data?.order.merchant_id}`,
    ),
    enabled: detail.data !== undefined,
  });

  if (detail.isLoading) {
    return (
      <Page>
        <div className="flex flex-col gap-2"><Skeleton height={220} /><Skeleton height={140} /><Skeleton height={110} /></div>
      </Page>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <Note tone="error">{t('common.error')}: {(detail.error as Error)?.message ?? ''}</Note>
        <p className="mt-3"><Link to="/orders" className="tb-btn tb-btn-soft tb-btn-sm">{t('track.backToOrders')}</Link></p>
      </Page>
    );
  }

  const { order } = detail.data;
  const canCancel = order.status === 'awaiting_payment' || order.status === 'placed';
  const chatting = order.status === 'accepted' || order.status === 'ready' || order.status === 'picked_up';
  const done = order.status === 'delivered' || order.status === 'completed';
  const closed = done || order.status === 'cancelled' || order.status === 'rejected';

  async function cancel() {
    setCancelMsg('');
    setCancelling(true);
    try {
      const res = await cancelOrder({ id: order.id });
      setCancelMsg(res.refunded ? t('track.cancelledRefund') : t('track.cancelled'));
      void detail.refetch();
    } catch {
      setCancelMsg(t('common.error'));
    } finally {
      setCancelling(false);
    }
  }

  const pickup = shop.data ? { lat: shop.data.lat, lng: shop.data.lng, label: shop.data.name } : null;
  const drop = order.dropoff ? { ...order.dropoff, label: t('track.home') } : null;
  const delivery = detail.data.delivery;
  const courier = delivery?.courier ? toCourierInfo(delivery.courier) : null;
  const courierDot = delivery?.courierLast ? { lat: delivery.courierLast.lat, lng: delivery.courierLast.lng } : null;

  return (
    <Page>
      <p className="tb-h2">{t('track.orderCode').replace('{code}', order.code)}</p>
      <h1 className="tb-display mt-1" aria-live="polite">{t(`track.s_${order.status}`)}</h1>
      <div className="mt-3"><StatusTimeline status={order.status} /></div>
      {pickup && drop && (
        <div className="mt-3">
          <LiveMap
            pickup={pickup}
            dropoff={drop}
            courier={courierDot}
            progress={progressFor(order.status)}
            etaText={etaText({ windowEnd: order.window_end, readyAt: order.ready_at_est, t })}
            statusText={t(`track.d_${order.status === 'completed' ? 'delivered' : order.status}`)}
          />
        </div>
      )}
      <div className="mt-3">
        <CourierCard courier={courier} unit={unitFor(i18n.language)} />
      </div>
      <PinHandover pin={order.delivery_pin} status={order.status} />
      <NoCourierPanel order={order} />
      {chatting && (
        <>
          <CheerPanel orderId={order.id} />
          <ChatPanel orderId={order.id} />
        </>
      )}
      {done && (
        <>
          <RatingsSection orderId={order.id} />
          <ImpactCard order={order} />
        </>
      )}
      {closed && detail.data && (
        <ReceiptCard detail={detail.data} restaurant={shop.data?.name ?? order.merchant_id} />
      )}
      <section className="tb-total mt-3" aria-label={t('checkout.total')}>
        <p className="flex justify-between items-end">
          <span className="font-bold">{t('checkout.total')}</span>
          <span className="tb-grand">{formatMoney(order.total.amount_minor, order.currency, i18n.language)}</span>
        </p>
        <p className="tb-sub">{t('track.paidVia').replace('{method}', order.payment_method)}</p>
      </section>
      {cancelMsg && <div className="mt-3"><Note tone="info">{cancelMsg}</Note></div>}
      {canCancel && (
        <div className="mt-3">
          <Button variant="danger" block disabled={cancelling} onClick={() => void cancel()}>
            {t('track.cancel')}
          </Button>
        </div>
      )}
      <p className="mt-3"><Link to="/orders" className="tb-btn tb-btn-soft tb-btn-sm">{t('track.backToOrders')}</Link></p>
    </Page>
  );
}

/** Recent orders list linking into live tracking. */
export function OrdersPage() {
  const { t } = useTranslation();
  const orders = useQuery({ queryKey: ['orders'], queryFn: listOrders });
  return (
    <Page>
      <h1 className="tb-display">{t('track.ordersTitle')}</h1>
      {orders.isLoading && <div className="flex flex-col gap-2 mt-3"><Skeleton height={80} /><Skeleton height={80} /></div>}
      {orders.isError && (
        <div className="mt-3 flex flex-col gap-2">
          <Note tone="error">{t('common.error')}: {(orders.error as Error).message}</Note>
          <Button variant="soft" size="sm" onClick={() => void orders.refetch()}>{t('common.retry')}</Button>
        </div>
      )}
      <div className="flex flex-col gap-2 mt-3">
        {(orders.data ?? []).map((o) => (
          <Link key={o.id} to={`/order/${o.id}`} className="tb-line-row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="flex-1 min-w-0">
              <strong className="block truncate">{o.code} · {t(`track.s_${o.status}`)}</strong>
              <span className="tb-price">{formatMoney(o.total.amount_minor, o.currency, i18n.language)}</span>
            </span>
            <span aria-hidden="true">→</span>
          </Link>
        ))}
        {orders.data?.length === 0 && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="tb-sub">{t('track.noOrders')}</p>
            <p><Link to="/" className="tb-btn tb-btn-ember tb-btn-sm">{t('nav.home')}</Link></p>
          </div>
        )}
      </div>
    </Page>
  );
}
