/** Live order operations: loud incoming alerts, accept/ready/handover queue. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import { Badge, Button, Field, Item, List, Note, Page } from '../../components/ui';
import { acceptOrder, listOrders, readyOrder, rejectOrder } from './api';
import { setPrepMinutes, type MerchantProfile } from '../menu/api';
import { api } from '../../lib/api';
import { playKitchenAlarm, speakKitchen, stopKitchenAlarm, unlockKitchenAudio, type KitchenLang } from './alert';
import { ensureKitchenPush, type PushState } from './push';
import { merchantSocket, type MerchantMsg } from './socket';
import { formatMinor, readyCountdown } from './money';
import { isAwaitingPickup, isCooking, isDead, isHandedOver, isIncoming, type Order } from './types';

const POLL_MS = 8000;
const PREP_MIN = 5;
const PREP_MAX = 120;

type WakeLock = { release: () => Promise<void> };

async function holdScreen(): Promise<WakeLock | null> {
  try {
    const nav = navigator as unknown as { wakeLock?: { request: (kind: string) => Promise<WakeLock> } };
    if (!nav.wakeLock) return null;
    return await nav.wakeLock.request('screen');
  } catch {
    return null;
  }
}

function langOf(code: string): KitchenLang {
  if (code === 'id') return 'id';
  if (code === 'ms') return 'ms';
  return 'en';
}

export interface CourierLine {
  kind: 'searching' | 'notified' | 'handed' | 'staff' | 'none';
  etaMin: number | null;
}

function etaMinOf(etaS: number | null | undefined): number | null {
  if (typeof etaS !== 'number' || !Number.isFinite(etaS) || etaS < 0) return null;
  return Math.max(1, Math.round(etaS / 60));
}

/**
 * Courier line: real dispatch data first (`Order.delivery` when the API
 * exposes it), honest status-derived text otherwise. The merchant order
 * list carries no delivery detail today, so the fallback is the live path;
 * WS `order.status` events + polling keep it fresh.
 */
function courierLine(order: Order): CourierLine {
  const status = order.delivery?.status;
  if (typeof status === 'string' && status !== '') {
    const etaMin = etaMinOf(order.delivery?.eta_s);
    if (status === 'searching' || status === 'offered') return { kind: 'searching', etaMin };
    if (status === 'assigned' || status === 'at_pickup') return { kind: 'notified', etaMin };
    if (status === 'picked_up' || status === 'at_dropoff' || status === 'delivered') {
      return { kind: 'handed', etaMin };
    }
    if (status === 'staff_searching') return { kind: 'staff', etaMin };
    if (status === 'no_courier' || status === 'cancelled') return { kind: 'none', etaMin };
  }
  if (isHandedOver(order.status)) return { kind: 'handed', etaMin: null };
  if (order.status === 'ready') return { kind: 'notified', etaMin: null };
  if (order.status === 'accepted') return { kind: 'searching', etaMin: null };
  return { kind: 'none', etaMin: null };
}

interface CardState {
  prep: number;
  reason: string;
  busy: boolean;
  error: string;
}

const freshCard = (prep: number): CardState => ({ prep, reason: '', busy: false, error: '' });

export default function OrdersPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [receiving, setReceiving] = useState(false);
  const [push, setPush] = useState<PushState | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [now, setNow] = useState(() => Date.now());
  const seenPlaced = useRef<Set<string> | null>(null);
  const lock = useRef<WakeLock | null>(null);

  const profile = useQuery({
    queryKey: ['merchant-me'],
    queryFn: () => api<{ merchant: { prep_minutes: number } | null }>('/merchant/merchants/me'),
  });
  const defaultPrep = profile.data?.merchant?.prep_minutes || 15;

  const orders = useQuery({
    queryKey: ['merchant-orders'],
    queryFn: listOrders,
    refetchInterval: receiving ? POLL_MS : false,
  });

  const patchCard = useCallback((id: string, patch: Partial<CardState>) => {
    setCards((c) => ({ ...c, [id]: { ...(c[id] ?? freshCard(15)), ...patch } }));
  }, []);

  const cardOf = useCallback(
    (id: string): CardState => cards[id] ?? freshCard(defaultPrep),
    [cards, defaultPrep],
  );

  // Clock tick for ready-countdowns (cheap, local only).
  useEffect(() => {
    if (!receiving) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [receiving]);

  // Loud alarm + voice on every newly seen placed order.
  useEffect(() => {
    const list = orders.data;
    if (!list) return;
    if (seenPlaced.current === null) {
      seenPlaced.current = new Set(list.filter((o) => isIncoming(o.status)).map((o) => o.id));
      return;
    }
    for (const o of list) {
      if (isIncoming(o.status) && !seenPlaced.current.has(o.id)) {
        seenPlaced.current.add(o.id);
        if (receiving) {
          playKitchenAlarm();
          speakKitchen({ text: t('orders.newArrived', { code: o.code }), lang: langOf(i18n.language) });
        }
      }
    }
  }, [orders.data, receiving, t, i18n.language]);

  // Live status events: refresh the queue, note staff-fallback traffic.
  useEffect(() => {
    if (!receiving) return;
    const off = merchantSocket.onMessage((msg: MerchantMsg) => {
      if (msg.type === 'order.status') {
        stopKitchenAlarm();
        void qc.invalidateQueries({ queryKey: ['merchant-orders'] });
        if (msg.status === 'placed') {
          playKitchenAlarm();
          speakKitchen({ text: t('orders.newArrived', { code: '' }), lang: langOf(i18n.language) });
        }
      } else if (msg.type === 'notice') {
        setNotices((n) => [msg.text, ...n].slice(0, 5));
        void qc.invalidateQueries({ queryKey: ['merchant-orders'] });
      }
    });
    void merchantSocket.connect();
    const relock = () => {
      if (receiving) void holdScreen().then((l) => {
        lock.current = l;
      });
    };
    document.addEventListener('visibilitychange', relock);
    return () => {
      off();
      document.removeEventListener('visibilitychange', relock);
    };
  }, [receiving, qc, t, i18n.language]);

  async function startReceiving(): Promise<void> {
    unlockKitchenAudio();
    setReceiving(true);
    setPush(await ensureKitchenPush());
    lock.current = await holdScreen();
    seenPlaced.current = null;
    void orders.refetch();
  }

  function stopReceiving(): void {
    setReceiving(false);
    merchantSocket.disconnect();
    stopKitchenAlarm();
    void lock.current?.release().catch(() => undefined);
    lock.current = null;
  }

  async function doAccept(order: Order): Promise<void> {
    const card = cardOf(order.id);
    patchCard(order.id, { busy: true, error: '' });
    stopKitchenAlarm();
    try {
      if (card.prep !== defaultPrep) {
        const me = await api<{ merchant: MerchantProfile | null }>('/merchant/merchants/me');
        if (me.merchant) await setPrepMinutes({ profile: me.merchant, prep: card.prep });
      }
      await acceptOrder({ id: order.id });
      void qc.invalidateQueries({ queryKey: ['merchant-orders'] });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t('common.error');
      logger.warn('kitchen accept failed', { err: msg });
      patchCard(order.id, { error: msg });
    } finally {
      patchCard(order.id, { busy: false });
    }
  }

  async function doReject(order: Order): Promise<void> {
    const card = cardOf(order.id);
    patchCard(order.id, { busy: true, error: '' });
    stopKitchenAlarm();
    try {
      await rejectOrder({ id: order.id, reason: card.reason });
      void qc.invalidateQueries({ queryKey: ['merchant-orders'] });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t('common.error');
      logger.warn('kitchen reject failed', { err: msg });
      patchCard(order.id, { error: msg });
    } finally {
      patchCard(order.id, { busy: false });
    }
  }

  async function doReady(order: Order): Promise<void> {
    patchCard(order.id, { busy: true, error: '' });
    try {
      await readyOrder({ id: order.id });
      void qc.invalidateQueries({ queryKey: ['merchant-orders'] });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t('common.error');
      logger.warn('kitchen ready failed', { err: msg });
      patchCard(order.id, { error: msg });
    } finally {
      patchCard(order.id, { busy: false });
    }
  }

  const list = orders.data ?? [];
  const incoming = list.filter((o) => isIncoming(o.status));
  const cooking = list.filter((o) => isCooking(o.status));
  const pickup = list.filter((o) => isAwaitingPickup(o.status));
  const handed = list.filter((o) => isHandedOver(o.status));
  const dead = list.filter((o) => isDead(o.status));

  return (
    <Page>
      <h1 className="tb-display">{t('orders.title')}</h1>
      <p className="tb-sub">{t('orders.sub')}</p>

      <div className="tb-kitchen-bar">
        {receiving ? (
          <Button variant="danger" block onClick={stopReceiving}>■ {t('orders.stop')}</Button>
        ) : (
          <Button block onClick={() => void startReceiving()}>{t('orders.start')}</Button>
        )}
        <p className="tb-kitchen-state" role="status">
          {receiving ? `● ${t('orders.live')}` : `○ ${t('orders.idle')}`}
          {push === 'denied' ? ` · ${t('orders.pushDenied')}` : ''}
          {push === 'failed' || push === 'unsupported' ? ` · ${t('orders.pushOff')}` : ''}
        </p>
      </div>

      {notices.length > 0 && (
        <List className="flex flex-col gap-2 mt-3">
          {notices.map((n, i) => (
            <Item key={`${String(i)}-${n}`} index={i}>
              <Note tone="info">{n}</Note>
            </Item>
          ))}
        </List>
      )}

      {orders.isLoading ? (
        <div className="tb-skel mt-3" style={{ height: 220 }} />
      ) : (
        <>
          {incoming.length > 0 && (
            <section aria-label={t('orders.incoming')}>
              <h2 className="tb-h2 tb-kitchen-h">{t('orders.incoming')} ({incoming.length})</h2>
              <List className="flex flex-col gap-3">
                {incoming.map((o, i) => {
                  const card = cardOf(o.id);
                  return (
                    <Item key={o.id} index={i}>
                      <article className="tb-card tb-order-new" aria-label={`${t('orders.order')} ${o.code}`}>
                        <p className="tb-order-code">{o.code}</p>
                        <p className="tb-order-total">{formatMinor({ amountMinor: o.total.amount_minor, currency: o.currency })}</p>
                        <p className="tb-person-sub">
                          {t('orders.size', { size: o.size_class })} · {o.spill_risk} · {o.payment_method}
                        </p>
                        <div className="tb-prep">
                          <span>{t('orders.prepMin')}</span>
                          <span className="tb-prep-btns">
                            <Button
                              variant="soft"
                              onClick={() => patchCard(o.id, { prep: Math.max(PREP_MIN, card.prep - 5) })}
                            >
                              −
                            </Button>
                            <strong aria-live="polite">{card.prep}′</strong>
                            <Button
                              variant="soft"
                              onClick={() => patchCard(o.id, { prep: Math.min(PREP_MAX, card.prep + 5) })}
                            >
                              +
                            </Button>
                          </span>
                        </div>
                        <div className="tb-kitchen-actions">
                          <Button disabled={card.busy} onClick={() => void doAccept(o)}>
                            ✓ {t('orders.accept')}
                          </Button>
                          <Button variant="danger" disabled={card.busy} onClick={() => void doReject(o)}>
                            ✕ {t('orders.reject')}
                          </Button>
                        </div>
                        <Field label={t('orders.reasonOpt')}>
                          <input
                            className="tb-input"
                            value={card.reason}
                            onChange={(e) => patchCard(o.id, { reason: e.target.value })}
                            placeholder={t('orders.reasonPh')}
                          />
                        </Field>
                        {card.error && <div className="mt-2"><Note tone="error">{card.error}</Note></div>}
                      </article>
                    </Item>
                  );
                })}
              </List>
            </section>
          )}

          {cooking.length > 0 && (
            <section aria-label={t('orders.cooking')}>
              <h2 className="tb-h2 tb-kitchen-h">{t('orders.cooking')} ({cooking.length})</h2>
              <List className="flex flex-col gap-3">
                {cooking.map((o, i) => {
                  const card = cardOf(o.id);
                  return (
                    <Item key={o.id} index={i}>
                      <article className="tb-card" aria-label={`${t('orders.order')} ${o.code}`}>
                        <p className="tb-order-row">
                          <strong>{o.code}</strong>
                          <Badge green>{readyCountdown({ readyAtEst: o.ready_at_est, now })}</Badge>
                        </p>
                        <CourierEta courier={courierLine(o)} />
                        <div className="mt-2">
                          <Button block disabled={card.busy} onClick={() => void doReady(o)}>
                            {t('orders.ready')}
                          </Button>
                        </div>
                        {card.error && <div className="mt-2"><Note tone="error">{card.error}</Note></div>}
                      </article>
                    </Item>
                  );
                })}
              </List>
            </section>
          )}

          {pickup.length > 0 && (
            <section aria-label={t('orders.pickup')}>
              <h2 className="tb-h2 tb-kitchen-h">{t('orders.pickup')} ({pickup.length})</h2>
              <List className="flex flex-col gap-3">
                {pickup.map((o, i) => (
                  <Item key={o.id} index={i}>
                    <article className="tb-card tb-order-ready" aria-label={`${t('orders.order')} ${o.code}`}>
                      <p className="tb-order-row"><strong>{o.code}</strong><Badge green>{t('orders.readyBadge')}</Badge></p>
                      <p className="tb-pickup-code" aria-label={t('orders.pickupCode')}>{o.pickup_code || '····'}</p>
                      <p className="tb-person-sub">{t('orders.showCode')}</p>
                      <CourierEta courier={courierLine(o)} />
                    </article>
                  </Item>
                ))}
              </List>
            </section>
          )}

          {handed.length > 0 && (
            <section aria-label={t('orders.handed')}>
              <h2 className="tb-h2 tb-kitchen-h">{t('orders.handed')} ({handed.length})</h2>
              <List className="flex flex-col gap-2">
                {handed.map((o, i) => (
                  <Item key={o.id} index={i}>
                    <p className="tb-order-row">
                      <span>✓ {o.code} · {formatMinor({ amountMinor: o.subtotal.amount_minor, currency: o.currency })}</span>
                      <Badge green>{o.status}</Badge>
                    </p>
                  </Item>
                ))}
              </List>
            </section>
          )}

          {dead.length > 0 && (
            <section aria-label={t('orders.dead')}>
              <h2 className="tb-h2 tb-kitchen-h">{t('orders.dead')} ({dead.length})</h2>
              <List className="flex flex-col gap-2">
                {dead.map((o, i) => (
                  <Item key={o.id} index={i}>
                    <p className="tb-order-row">
                      <span>{o.code} · {t('orders.refundedAuto')}</span>
                      <Badge>{o.status}</Badge>
                    </p>
                  </Item>
                ))}
              </List>
            </section>
          )}

          {list.length === 0 && !orders.isLoading && (
            <div className="tb-quote mt-3">
              <p>“{t('orders.empty')}”</p>
              <small>{t('orders.emptySub')}</small>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

/** Compact courier line: live dispatch text with ETA when the API sends one. */
function CourierEta(params: { courier: CourierLine }) {
  const { t } = useTranslation();
  if (params.courier.kind === 'none') return null;
  const eta = params.courier.etaMin !== null ? ` ${t('orders.courierEta', { min: params.courier.etaMin })}` : '';
  return (
    <p className="tb-person-sub tb-courier-line">
      {params.courier.kind === 'searching' && `${t('orders.courierSearching')}${eta}`}
      {params.courier.kind === 'notified' && `${t('orders.courierNotified')}${eta}`}
      {params.courier.kind === 'staff' && t('orders.courierStaff')}
      {params.courier.kind === 'handed' && t('orders.courierHanded')}
    </p>
  );
}
