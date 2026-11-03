/** Live order operations: loud incoming alerts, accept/ready/handover queue. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import { Badge, Button, Field, Item, List, LoadMore, Note, Page, TextInput } from '../../components/ui';
import { acceptOrder, cancelMerchantOrder, listOrders, readyOrder, rejectOrder } from './api';
import { setPrepMinutes, type MerchantProfile } from '../menu/api';
import { useReceivingState } from './receiving';
import { api } from '../../lib/api';
import { playKitchenAlarm, speakKitchen, stopKitchenAlarm, unlockKitchenAudio, type KitchenLang } from './alert';
import { ensureKitchenPush, type PushState } from './push';
import { merchantSocket, type MerchantMsg } from './socket';
import { formatMinor, readyCountdown } from './money';
import { isAwaitingPickup, isCooking, isDead, isHandedOver, isIncoming, type Order } from './types';

const POLL_MS = 8000;
const PREP_MIN = 5;
const PREP_MAX = 120;
/** Kitchen queue scroll page: newest 10 first, auto-loaded on scroll. */
const PAGE_SIZE = 10;

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
  courierName: string | null;
  courierMode: string | null;
}

function etaMinOf(etaS: number | null | undefined): number | null {
  if (typeof etaS !== 'number' || !Number.isFinite(etaS) || etaS < 0) return null;
  return Math.max(1, Math.round(etaS / 60));
}

/** Seconds since the last live courier dot, or null when no fresh dot. */
function liveDotS(dots: Record<string, number>, orderId: string, now: number): number | null {
  const at = dots[orderId];
  if (at === undefined) return null;
  const s = Math.round((now - at) / 1000);
  if (s < 0 || s > 120) return null;
  return s;
}

function courierIdentity(delivery: Order['delivery']): { name: string | null; mode: string | null } {
  if (!delivery) return { name: null, mode: null };
  const raw = delivery as Record<string, unknown>;
  const name = typeof raw.courier_name === 'string' && raw.courier_name !== ''
    ? raw.courier_name
    : typeof raw.courierName === 'string' && raw.courierName !== ''
      ? raw.courierName
      : null;
  const mode = typeof raw.courier_mode === 'string' && raw.courier_mode !== ''
    ? raw.courier_mode
    : typeof raw.courierMode === 'string' && raw.courierMode !== ''
      ? raw.courierMode
      : null;
  return { name, mode };
}

/**
 * Courier line: real dispatch data first (`Order.delivery.status`/`eta_s`,
 * plus `courier_name`/`courier_mode` once someone accepts), honest
 * status-derived text otherwise. WS `order.status` events + polling keep it
 * fresh. The "searching" line disappears the moment a courier is assigned —
 * the line flips to the courier's name instead of lingering.
 */
function courierLine(order: Order): CourierLine {
  const status = order.delivery?.status;
  const who = courierIdentity(order.delivery);
  if (typeof status === 'string' && status !== '') {
    const etaMin = etaMinOf(order.delivery?.eta_s);
    if (status === 'searching' || status === 'offered') return { kind: 'searching', etaMin, courierName: null, courierMode: null };
    if (status === 'assigned' || status === 'at_pickup') return { kind: 'notified', etaMin, courierName: who.name, courierMode: who.mode };
    if (status === 'picked_up' || status === 'at_dropoff' || status === 'delivered') {
      return { kind: 'handed', etaMin, courierName: who.name, courierMode: who.mode };
    }
    if (status === 'staff_searching') return { kind: 'staff', etaMin, courierName: null, courierMode: null };
    if (status === 'no_courier' || status === 'cancelled') return { kind: 'none', etaMin, courierName: null, courierMode: null };
  }
  if (isHandedOver(order.status)) return { kind: 'handed', etaMin: null, courierName: null, courierMode: null };
  // Ready but unclaimed: the backend starts a fresh courier wave at the
  // ready tap — say "finding", never "courier notified", until a real
  // delivery row names one. The searching line disappears on assignment.
  if (order.status === 'ready') return { kind: 'searching', etaMin: null, courierName: null, courierMode: null };
  if (order.status === 'accepted') return { kind: 'searching', etaMin: null, courierName: null, courierMode: null };
  return { kind: 'none', etaMin: null, courierName: null, courierMode: null };
}

interface CardState {
  prep: number;
  reason: string;
  busy: boolean;
  error: string;
  confirmCancel: boolean;
}

const freshCard = (prep: number): CardState => ({ prep, reason: '', busy: false, error: '', confirmCancel: false });

export default function OrdersPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [push, setPush] = useState<PushState | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  // Last live-dot timestamp per order from `courier.location` frames.
  // Rendered as "live Ns ago" under the courier line — dots stream every
  // few seconds while a delivery is active, so this never triggers a
  // data refetch (the 8 s order poll + `delivery.eta` own the ETA).
  const [dots, setDots] = useState<Record<string, number>>({});
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [now, setNow] = useState(() => Date.now());
  const seenPlaced = useRef<Set<string> | null>(null);
  // order id → when its courier was last announced (each order is said once).
  const announced = useRef(new Map<string, number>());
  const announcedRecently = (orderId: string): boolean => {
    const at = announced.current.get(orderId);
    const recent = at !== undefined && Date.now() - at < ANNOUNCE_ONCE_MS;
    if (!recent) announced.current.set(orderId, Date.now());
    return recent;
  };
  const lock = useRef<WakeLock | null>(null);

  const profile = useQuery({
    queryKey: ['merchant-me'],
    queryFn: () => api<{ merchant: { id?: string; prep_minutes: number } | null }>('/merchant/merchants/me'),
  });
  const defaultPrep = profile.data?.merchant?.prep_minutes || 15;
  const merchantId = profile.data?.merchant?.id ?? null;
  // Persisted across navigation/reload so the button reflects the kitchen's
  // real receiving state instead of resetting to "Start".
  const { receiving, setReceiving } = useReceivingState(merchantId);

  const orders = useInfiniteQuery({
    queryKey: ['merchant-orders'],
    queryFn: ({ pageParam }) => listOrders({ page: pageParam, perPage: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
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
    const pages = orders.data?.pages;
    if (!pages) return;
    const list = pages.flatMap((p) => p.orders);
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

  // Live status events: refresh the queue, note staff-fallback traffic, and
  // announce the courier the moment they accept (the "finding courier" line
  // flips to their name at the same time — no lingering search state).
  useEffect(() => {
    if (!receiving) return;
    const off = merchantSocket.onMessage((msg: MerchantMsg) => {
      if (msg.type === 'order.status') {
        stopKitchenAlarm();
        void qc.invalidateQueries({ queryKey: ['merchant-orders'] });
        if (msg.status === 'placed') {
          playKitchenAlarm();
          speakKitchen({ text: t('orders.newArrived', { code: '' }), lang: langOf(i18n.language) });
        } else if ((msg.delivery_status === 'assigned' || msg.delivery_status === 'at_pickup') && !announcedRecently(msg.order_id)) {
          // Fallback for servers without `delivery.assigned`; said once per order.
          const line = t('orders.courierFoundKitchen');
          setNotices((n) => [line, ...n].slice(0, 5));
          speakKitchen({ text: line, lang: langOf(i18n.language) });
        }
      } else if (msg.type === 'delivery.assigned') {
        stopKitchenAlarm();
        void qc.invalidateQueries({ queryKey: ['merchant-orders'] });
        announced.current.set(msg.order_id, Date.now());
        const who = msg.courier_name
          ? t('orders.courierAssigned', { name: msg.courier_name, mode: courierModeLabel(t, msg.courier_mode) })
          : t('orders.courierFoundKitchen');
        setNotices((n) => [who, ...n].slice(0, 5));
        speakKitchen({ text: who, lang: langOf(i18n.language) });
      } else if (msg.type === 'delivery.eta') {
        // Fresh server-side ETA: refetch so the card's courier line shows
        // the real minutes at once instead of waiting for the next poll.
        void qc.invalidateQueries({ queryKey: ['merchant-orders'] });
      } else if (msg.type === 'courier.location') {
        const parsed = msg.ts !== undefined ? Date.parse(msg.ts) : NaN;
        const stamp = Number.isFinite(parsed) ? parsed : Date.now();
        const sec = Math.floor(stamp / 1000);
        setDots((d) => (Math.floor((d[msg.order_id] ?? 0) / 1000) === sec ? d : { ...d, [msg.order_id]: stamp }));
      } else if (msg.type === 'notice') {
        setNotices((n) => [msg.text, ...n].slice(0, 5));
        void qc.invalidateQueries({ queryKey: ['merchant-orders'] });
      }
    });
    void merchantSocket.connect();
    // Restored sessions (persisted `receiving` across navigation/reload):
    // re-acquire screen lock + push silently; the loud alarm still needs the
    // next tap (browser autoplay policy), which startReceiving provides.
    void holdScreen().then((l) => {
      lock.current = l;
    });
    if (push === null) {
      void ensureKitchenPush().then(setPush);
    }
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

  async function doCancel(order: Order): Promise<void> {
    const card = cardOf(order.id);
    if (!card.confirmCancel) {
      patchCard(order.id, { confirmCancel: true, error: '' });
      return;
    }
    patchCard(order.id, { busy: true, error: '' });
    stopKitchenAlarm();
    try {
      await cancelMerchantOrder({ id: order.id, reason: card.reason });
      patchCard(order.id, { confirmCancel: false });
      void qc.invalidateQueries({ queryKey: ['merchant-orders'] });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t('common.error');
      logger.warn('kitchen cancel failed', { err: msg });
      patchCard(order.id, { error: msg });
    } finally {
      patchCard(order.id, { busy: false });
    }
  }

  const list = orders.data?.pages.flatMap((p) => p.orders) ?? [];
  const total = orders.data?.pages[0]?.total;
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
              <List className="tb-orders-grid">
                {incoming.map((o, i) => {
                  const card = cardOf(o.id);
                  return (
                    <Item key={o.id} index={i}>
                      <article className="tb-card tb-order-new" aria-label={`${t('orders.order')} ${o.code}`}>
                        <p className="tb-order-code">{o.code}</p>
                        <p className="tb-order-total">{formatMinor({ amountMinor: o.total.amount_minor, currency: o.currency })}</p>
                        <p className="tb-person-sub">
                          {t('orders.size', { size: o.size_class })} · {o.payment_method}
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
                          <TextInput
                            value={card.reason}
                            onChange={(v) => patchCard(o.id, { reason: v })}
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
              <List className="tb-orders-grid">
                {cooking.map((o, i) => {
                  const card = cardOf(o.id);
                  return (
                    <Item key={o.id} index={i}>
                      <article className="tb-card" aria-label={`${t('orders.order')} ${o.code}`}>
                        <p className="tb-order-row">
                          <strong>{o.code}</strong>
                          <Badge green>{readyCountdown({ readyAtEst: o.ready_at_est, now })}</Badge>
                        </p>
                        <CourierEta courier={courierLine(o)} liveS={liveDotS(dots, o.id, now)} />
                        <div className="mt-2 flex flex-col gap-2">
                          <Button block disabled={card.busy} onClick={() => void doReady(o)}>
                            {t('orders.ready')}
                          </Button>
                          {!card.confirmCancel ? (
                            <Button variant="soft" block disabled={card.busy} onClick={() => void doCancel(o)}>
                              {t('orders.cancelOrder')}
                            </Button>
                          ) : (
                            <>
                              <Field label={t('orders.cancelReasonOpt')}>
                                <TextInput
                                  value={card.reason}
                                  onChange={(v) => patchCard(o.id, { reason: v })}
                                  placeholder={t('orders.cancelReasonPh')}
                                />
                              </Field>
                              <div className="tb-kitchen-actions">
                                <Button variant="danger" disabled={card.busy} onClick={() => void doCancel(o)}>
                                  ✓ {t('orders.confirmCancel')}
                                </Button>
                                <Button variant="soft" disabled={card.busy} onClick={() => patchCard(o.id, { confirmCancel: false })}>
                                  {t('common.back')}
                                </Button>
                              </div>
                              <Note tone="info">{t('orders.cancelRefundNote')}</Note>
                            </>
                          )}
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
              <List className="tb-orders-grid">
                {pickup.map((o, i) => {
                  const card = cardOf(o.id);
                  return (
                    <Item key={o.id} index={i}>
                      <article className="tb-card tb-order-ready" aria-label={`${t('orders.order')} ${o.code}`}>
                        <p className="tb-order-row"><strong>{o.code}</strong><Badge green>{t('orders.readyBadge')}</Badge></p>
                        <p className="tb-person-sub">{t('orders.pickupStep')}</p>
                        <p className="tb-pickup-code" aria-label={t('orders.pickupCode')}>{o.pickup_code || '····'}</p>
                        <p className="tb-person-sub">{t('orders.showCode')}</p>
                        <p className="tb-person-sub">{t('orders.pickupCodeNote')}</p>
                        <CourierEta courier={courierLine(o)} liveS={liveDotS(dots, o.id, now)} />
                        <div className="mt-2 flex flex-col gap-2">
                          {!card.confirmCancel ? (
                            <Button variant="soft" block disabled={card.busy} onClick={() => void doCancel(o)}>
                              {t('orders.cancelOrder')}
                            </Button>
                          ) : (
                            <>
                              <Field label={t('orders.cancelReasonOpt')}>
                                <TextInput
                                  value={card.reason}
                                  onChange={(v) => patchCard(o.id, { reason: v })}
                                  placeholder={t('orders.cancelReasonPh')}
                                />
                              </Field>
                              <div className="tb-kitchen-actions">
                                <Button variant="danger" disabled={card.busy} onClick={() => void doCancel(o)}>
                                  ✓ {t('orders.confirmCancel')}
                                </Button>
                                <Button variant="soft" disabled={card.busy} onClick={() => patchCard(o.id, { confirmCancel: false })}>
                                  {t('common.back')}
                                </Button>
                              </div>
                              <Note tone="info">{t('orders.cancelRefundNote')}</Note>
                            </>
                          )}
                        </div>
                        {card.error && <div className="mt-2"><Note tone="error">{card.error}</Note></div>}
                      </article>
                    </Item>
                  );
                })}
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
          {!orders.isLoading && (
            <>
              {total !== undefined && list.length > 0 && (
                <p className="tb-person-sub mt-3" role="status">
                  {t('orders.showingOf', { shown: list.length, total })}
                </p>
              )}
              <LoadMore
                hasMore={orders.hasNextPage ?? false}
                loading={orders.isFetchingNextPage}
                label={t('orders.loadMore')}
                onLoad={() => void orders.fetchNextPage()}
              />
            </>
          )}
        </>
      )}
    </Page>
  );
}

/** A kitchen announces each order's courier once (frames repeat as statuses move). */
const ANNOUNCE_ONCE_MS = 10 * 60_000;

/** "runner" | "biker" | "staff" → the kitchen's words for who is coming. */
function courierModeLabel(t: (key: string, opts?: Record<string, unknown>) => string, mode: string | null | undefined): string {
  if (!mode) return '';
  return t(`orders.mode_${mode}`, { defaultValue: mode });
}

/** Compact courier line: live dispatch text with ETA when the API sends one. */
function CourierEta(params: { courier: CourierLine; liveS: number | null }) {
  const { t } = useTranslation();
  if (params.courier.kind === 'none') return null;
  const eta = params.courier.etaMin !== null ? ` ${t('orders.courierEta', { min: params.courier.etaMin })}` : '';
  const who = params.courier.courierName
    ? ` ${t('orders.courierAssigned', { name: params.courier.courierName, mode: courierModeLabel(t, params.courier.courierMode) })}`
    : '';
  const live = params.liveS !== null && (params.courier.kind === 'notified' || params.courier.kind === 'handed')
    ? ` ${t('orders.courierLive', { s: params.liveS })}`
    : '';
  return (
    <p className="tb-person-sub tb-courier-line">
      {params.courier.kind === 'searching' && `${t('orders.courierSearching')}${eta}`}
      {params.courier.kind === 'notified' && `${who.trim() !== '' ? who.trim() : t('orders.courierNotified')}${eta}${live}`}
      {params.courier.kind === 'staff' && t('orders.courierStaff')}
      {params.courier.kind === 'handed' && `${t('orders.courierHanded')}${live}`}
    </p>
  );
}
