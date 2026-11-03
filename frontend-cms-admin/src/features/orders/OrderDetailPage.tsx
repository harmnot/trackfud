/**
 * Order detail (A7 orders detail, PLAN §4.4 P0): parties, money, audit
 * timeline, delivery, chat, cheers/ratings, proof photo + checks, money
 * trail, and the support refund.
 *
 * All sections come from `GET /v1/admin/orders/{id}` — the same items,
 * events and delivery keys the customer/merchant apps render, plus admin
 * extras (actor ids, moderation flags, journal postings). Handover codes
 * are shown so support can talk through a stuck handover when one side
 * cannot open their app.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../lib/api';
import { formatMinor, formatValue, MISSING } from '../../lib/format';
import { logger } from '../../lib/logger';
import { Button, Item, List, Note, Page, StatusBadge } from '../../components/ui';
import { IdValue } from '../detail/fields';
import { FileImage } from '../detail/evidence';
import { fetchAdminOrder, refundAdminOrder } from './api';
import {
  isRefundable,
  type AdminDelivery,
  type AdminOrderDetail,
  type OrderMessage,
} from './types';

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const orderId = id.trim();
  const shortId = orderId === '' ? '' : orderId.slice(0, 8);
  const q = useQuery({
    queryKey: ['admin', 'orders', orderId],
    queryFn: () => fetchAdminOrder(orderId),
    enabled: orderId !== '',
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });

  const detail = q.data ?? null;

  return (
    <Page>
      <p className="tb-sub">
        <Link to="/orders" className="tb-link">
          ← All orders
        </Link>
      </p>
      {q.isLoading && (
        <List>
          {[0, 1].map((i) => (
            <Item key={i} index={i}>
              <div className="tb-skel" style={{ height: 120 }} />
            </Item>
          ))}
        </List>
      )}
      {orderId === '' && <NoOrderSelected />}
      {orderId !== '' && q.isError && (
        <OrderLoadError
          orderId={orderId}
          shortId={shortId}
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      )}
      {orderId !== '' && !q.isLoading && !q.isError && !detail && (
        <OrderUnavailable orderId={orderId} shortId={shortId} onRetry={() => void q.refetch()} />
      )}
      {detail && (
        <>
          <OrderHeader detail={detail} />
          <div className="tb-grid-2 mt-3">
            <SummaryCard detail={detail} />
            <RefundCard orderId={detail.order.id} detail={detail} />
          </div>
          <div className="tb-grid-2 mt-3">
            <TimelineCard detail={detail} />
            <DeliveryCard delivery={detail.delivery} />
          </div>
          <div className="tb-grid-2 mt-3">
            <ChatCard messages={detail.messages} />
            <SocialCard detail={detail} />
          </div>
          <div className="tb-grid-2 mt-3">
            <ProofCard detail={detail} />
            <MoneyCard detail={detail} />
          </div>
        </>
      )}
    </Page>
  );
}

function NoOrderSelected() {
  return (
    <section className="tb-card" aria-labelledby="order-empty-title">
      <h2 className="tb-h2" id="order-empty-title">
        No order selected
      </h2>
      <p className="tb-sub mt-3">
        Choose an order from the queue to review its timeline, delivery, chat, proof photo and
        money trail.
      </p>
      <div className="tb-actions">
        <Link to="/orders" className="tb-btn tb-btn-clay tb-btn-sm">
          Back to orders
        </Link>
      </div>
    </section>
  );
}

function OrderLoadError({
  orderId,
  shortId,
  error,
  onRetry,
}: {
  orderId: string;
  shortId: string;
  error: unknown;
  onRetry: () => void;
}) {
  const status = error instanceof ApiError ? error.status : null;
  const title =
    status === 404
      ? 'Order not found'
      : status === 403
        ? 'You do not have access to this order'
        : 'We could not load this order';
  const body =
    status === 404
      ? `We could not find order ${shortId}. It may have been archived, or the link is outdated. Please verify the order ID or return to the order queue to continue your review.`
      : status === 403
        ? `Your account does not have permission to view order ${shortId}. If you need access, please contact an administrator.`
        : `Something went wrong while retrieving order ${shortId}. Please check your connection and try again. If the issue persists, contact support with the order reference below.`;
  return (
    <section className="tb-card" aria-labelledby="order-error-title" role="alert">
      <h2 className="tb-h2" id="order-error-title">
        {title}
      </h2>
      <p className="tb-sub mt-3">{body}</p>
      <p className="tb-sub mt-3">
        Order reference: <span style={{ overflowWrap: 'anywhere' }}>{orderId}</span>
      </p>
      <div className="tb-actions">
        <Link to="/orders" className="tb-btn tb-btn-soft tb-btn-sm">
          Back to orders
        </Link>
        <Button variant="clay" small onClick={onRetry}>
          Try again
        </Button>
      </div>
    </section>
  );
}

function OrderUnavailable({
  orderId,
  shortId,
  onRetry,
}: {
  orderId: string;
  shortId: string;
  onRetry: () => void;
}) {
  return (
    <section className="tb-card" aria-labelledby="order-unavailable-title" role="status">
      <h2 className="tb-h2" id="order-unavailable-title">
        This order is not available right now
      </h2>
      <p className="tb-sub mt-3">
        We received an unexpected response for order {shortId}. Please try again — if the problem
        continues, contact support with the order reference below.
      </p>
      <p className="tb-sub mt-3">
        Order reference: <span style={{ overflowWrap: 'anywhere' }}>{orderId}</span>
      </p>
      <div className="tb-actions">
        <Link to="/orders" className="tb-btn tb-btn-soft tb-btn-sm">
          Back to orders
        </Link>
        <Button variant="clay" small onClick={onRetry}>
          Try again
        </Button>
      </div>
    </section>
  );
}

function OrderHeader({ detail }: { detail: AdminOrderDetail }) {
  const o = detail.order;
  return (
    <>
      <h1 className="tb-display">
        {o.code !== '' ? o.code : o.id.slice(0, 8)} <StatusBadge status={o.status} />
      </h1>
      <p className="tb-sub">
        {formatMinor(o.total.amount_minor, o.total.currency)} · {formatValue(o.merchant.name)} →{' '}
        {formatValue(o.customer.email)}
      </p>
    </>
  );
}

function SummaryCard({ detail }: { detail: AdminOrderDetail }) {
  const o = detail.order;
  return (
    <div className="tb-card">
      <h2 className="tb-h2">Summary</h2>
      <dl className="tb-kv mt-3">
        <div className="tb-kv-row">
          <dt>Order</dt>
          <dd>
            <IdValue id={o.id} label="order ID" />
          </dd>
        </div>
        <div className="tb-kv-row">
          <dt>Merchant</dt>
          <dd>{formatValue(o.merchant.name)}</dd>
        </div>
        <div className="tb-kv-row">
          <dt>Customer</dt>
          <dd>{formatValue(o.customer.email)}</dd>
        </div>
        <div className="tb-kv-row">
          <dt>Food</dt>
          <dd>{formatMinor(o.subtotal.amount_minor, o.subtotal.currency)}</dd>
        </div>
        <div className="tb-kv-row">
          <dt>Delivery fee</dt>
          <dd>{formatMinor(o.delivery_fee.amount_minor, o.delivery_fee.currency)}</dd>
        </div>
        <div className="tb-kv-row">
          <dt>Service fee</dt>
          <dd>{formatMinor(o.service_fee.amount_minor, o.service_fee.currency)}</dd>
        </div>
        <div className="tb-kv-row">
          <dt>Tip</dt>
          <dd>{formatMinor(o.tip.amount_minor, o.tip.currency)}</dd>
        </div>
        <div className="tb-kv-row">
          <dt>Total</dt>
          <dd>{formatMinor(o.total.amount_minor, o.total.currency)}</dd>
        </div>
        <div className="tb-kv-row">
          <dt>Payment</dt>
          <dd>
            {formatValue(o.payment_method)} · {formatValue(o.payment_status)}
          </dd>
        </div>
        <div className="tb-kv-row">
          <dt>Handover codes</dt>
          <dd>
            pickup {o.pickup_code !== '' ? o.pickup_code : MISSING} · PIN{' '}
            {o.delivery_pin !== '' ? o.delivery_pin : MISSING}
          </dd>
        </div>
        {detail.items.length > 0 && (
          <div className="tb-kv-row">
            <dt>Items</dt>
            <dd>
              {detail.items.map((it) => {
                const name = it.name['en'] ?? Object.values(it.name)[0] ?? it.menu_item_id;
                return `${it.qty}× ${name}`;
              })}
            </dd>
          </div>
        )}
        {o.cancel_reason !== '' && (
          <div className="tb-kv-row">
            <dt>Cancel reason</dt>
            <dd>{formatValue(o.cancel_reason)}</dd>
          </div>
        )}
        <div className="tb-kv-row">
          <dt>Created</dt>
          <dd>{o.created_at !== '' ? formatValue(o.created_at) : MISSING}</dd>
        </div>
      </dl>
    </div>
  );
}

function RefundCard({ orderId, detail }: { orderId: string; detail: AdminOrderDetail }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const refundable = isRefundable(detail);

  async function onRefund() {
    setErr('');
    setDone('');
    if (reason.trim() === '') {
      setErr('A refund reason is required and is audit-logged.');
      return;
    }
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    try {
      // Server is the decider: 409 when the order already moved on.
      await refundAdminOrder({ id: orderId, reason: reason.trim() });
      setDone('Order refunded in full. Customer, merchant, and courier (if assigned) have been notified.');
      setReason('');
      setArmed(false);
      await qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    } catch (e) {
      logger.warn('admin refund failed', { orderId });
      setErr(e instanceof Error ? e.message : 'The refund could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tb-card">
      <h2 className="tb-h2">Support refund</h2>
      {!refundable ? (
        <p className="tb-sub mt-3">
          This order cannot be refunded here (status {formatValue(detail.order.status)}). Only
          pre-pickup orders refund in the app — picked-up or settled orders go through finance.
        </p>
      ) : (
        <>
          <p className="tb-sub mt-3">
            Cancels the order and releases the escrow in full (wallet back, card leg reversed).
          </p>
          <label>
            <span className="tb-label">Refund reason (required, audit-logged)</span>
            <input
              className="tb-input"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setArmed(false);
              }}
              placeholder="e.g. kitchen fire, courier never arrived"
              aria-label="Refund reason"
              minLength={1}
            />
          </label>
          <div className="tb-actions">
            <Button variant="danger" small disabled={busy} onClick={() => void onRefund()}>
              {busy ? '…' : armed ? 'Click again to confirm refund' : 'Refund in full'}
            </Button>
          </div>
        </>
      )}
      {err !== '' && (
        <div className="mt-2">
          <Note tone="error">{err}</Note>
        </div>
      )}
      {done !== '' && (
        <div className="mt-2">
          <Note tone="info">{done}</Note>
        </div>
      )}
    </div>
  );
}

function TimelineCard({ detail }: { detail: AdminOrderDetail }) {
  return (
    <div className="tb-card">
      <h2 className="tb-h2">Timeline ({detail.events.length})</h2>
      {detail.events.length === 0 ? (
        <p className="tb-sub mt-3">No events recorded yet.</p>
      ) : (
        <ol className="mt-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {detail.events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="tb-sub" style={{ marginBottom: '0.5rem' }}>
              <strong>
                {formatValue(e.from)} → {formatValue(e.to)}
              </strong>{' '}
              by {formatValue(e.actor)}
              {e.reason !== '' && <>: {formatValue(e.reason)}</>}
              <br />
              <span>{formatValue(e.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function courierLabel(delivery: AdminDelivery): string {
  const c = delivery.courier;
  if (c && (c.first_name !== '' || c.mode !== '')) {
    const name = c.first_name !== '' ? c.first_name : 'courier';
    return c.mode !== '' ? `${name} (${c.mode})` : name;
  }
  if (delivery.courier_email !== '') return delivery.courier_email;
  if (delivery.courier_id !== '') return delivery.courier_id;
  return 'unassigned';
}

function DeliveryCard({ delivery }: { delivery: AdminDelivery | null }) {
  if (!delivery) {
    return (
      <div className="tb-card">
        <h2 className="tb-h2">Delivery</h2>
        <p className="tb-sub mt-3">Dispatch has not started for this order yet.</p>
      </div>
    );
  }
  return (
    <div className="tb-card">
      <h2 className="tb-h2">
        Delivery <StatusBadge status={delivery.status} />
      </h2>
      <dl className="tb-kv mt-3">
        <div className="tb-kv-row">
          <dt>Type</dt>
          <dd>{formatValue(delivery.type)}</dd>
        </div>
        <div className="tb-kv-row">
          <dt>Courier</dt>
          <dd>{courierLabel(delivery)}</dd>
        </div>
        {delivery.eta_s !== null && (
          <div className="tb-kv-row">
            <dt>ETA</dt>
            <dd>{Math.round(delivery.eta_s / 60)} min</dd>
          </div>
        )}
        {delivery.trip_m !== null && (
          <div className="tb-kv-row">
            <dt>Trip</dt>
            <dd>{(delivery.trip_m / 1000).toFixed(1)} km</dd>
          </div>
        )}
        {delivery.assigned_at && (
          <div className="tb-kv-row">
            <dt>Assigned</dt>
            <dd>{formatValue(delivery.assigned_at)}</dd>
          </div>
        )}
        {delivery.picked_up_at && (
          <div className="tb-kv-row">
            <dt>Picked up</dt>
            <dd>{formatValue(delivery.picked_up_at)}</dd>
          </div>
        )}
        {delivery.delivered_at && (
          <div className="tb-kv-row">
            <dt>Delivered</dt>
            <dd>{formatValue(delivery.delivered_at)}</dd>
          </div>
        )}
        {delivery.cancel_note !== '' && (
          <div className="tb-kv-row">
            <dt>Cancel note</dt>
            <dd>{formatValue(delivery.cancel_note)}</dd>
          </div>
        )}
        {delivery.route_warning !== '' && (
          <div className="tb-kv-row">
            <dt>Route note</dt>
            <dd>{formatValue(delivery.route_warning)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function ChatCard({ messages }: { messages: OrderMessage[] }) {
  return (
    <div className="tb-card">
      <h2 className="tb-h2">Chat ({messages.length})</h2>
      {messages.length === 0 ? (
        <p className="tb-sub mt-3">No messages on this order.</p>
      ) : (
        <ol className="mt-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {messages.map((m) => (
            <li key={m.id} className="tb-sub" style={{ marginBottom: '0.6rem' }}>
              <strong>{formatValue(m.sender)}</strong>
              {m.flagged && (
                <>
                  {' '}
                  <StatusBadge status="flagged" />
                </>
              )}
              : {formatValue(m.body)}
              {m.translated_body !== '' && m.translated_body !== m.body && (
                <span className="tb-sub">
                  <br />
                  ↳ {formatValue(m.translated_body)}
                </span>
              )}
              <br />
              <span>{formatValue(m.created_at)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SocialCard({ detail }: { detail: AdminOrderDetail }) {
  const r = detail.ratings;
  return (
    <div className="tb-card">
      <h2 className="tb-h2">Cheers & ratings</h2>
      <p className="tb-sub mt-3">
        {detail.cheers.count} cheer{detail.cheers.count === 1 ? '' : 's'}
        {detail.cheers.recent.length > 0 &&
          `: “${detail.cheers.recent.map((c) => c.message).join('” · “')}”`}
      </p>
      {!r ? (
        <p className="tb-sub mt-3">Not rated yet.</p>
      ) : (
        <dl className="tb-kv mt-3">
          <div className="tb-kv-row">
            <dt>Courier</dt>
            <dd>
              {r.courier_stars === null ? MISSING : `${r.courier_stars}★`}
              {r.courier_tags.length > 0 && ` · ${r.courier_tags.join(', ')}`}
            </dd>
          </div>
          <div className="tb-kv-row">
            <dt>Restaurant</dt>
            <dd>{r.restaurant_stars === null ? MISSING : `${r.restaurant_stars}★`}</dd>
          </div>
          {r.topics.length > 0 && (
            <div className="tb-kv-row">
              <dt>Topics</dt>
              <dd>{r.topics.join(', ')}</dd>
            </div>
          )}
          {r.abusive && (
            <div className="tb-kv-row">
              <dt>Abuse</dt>
              <dd>
                <StatusBadge status="flagged" />
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function ProofCard({ detail }: { detail: AdminOrderDetail }) {
  const proof = detail.proof;
  return (
    <div className="tb-card">
      <h2 className="tb-h2">Proof photo</h2>
      {!proof.file_id ? (
        <p className="tb-sub mt-3">No delivery photo submitted yet.</p>
      ) : (
        <div className="tb-shots">
          <FileImage fileId={proof.file_id} label="Delivery proof" />
        </div>
      )}
      {proof.checks.length === 0 ? (
        <p className="tb-sub mt-3">No proof checks recorded.</p>
      ) : (
        <dl className="tb-kv mt-3">
          {proof.checks.map((c, i) => (
            <div className="tb-kv-row" key={`${c.created_at}-${i}`}>
              <dt>{formatValue(c.verdict)}</dt>
              <dd>
                {formatValue(c.note)}
                {c.fallback && ' (fallback check)'} · {formatValue(c.created_at)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function MoneyCard({ detail }: { detail: AdminOrderDetail }) {
  const pay = detail.payments;
  return (
    <div className="tb-card">
      <h2 className="tb-h2">Money trail</h2>
      <p className="tb-sub mt-3">
        {formatValue(pay.method)} · {formatValue(pay.status)}
      </p>
      {pay.postings.length === 0 ? (
        <p className="tb-sub mt-3">No journal postings yet.</p>
      ) : (
        <dl className="tb-kv mt-3">
          {pay.postings.map((p, i) => (
            <div className="tb-kv-row" key={`${p.created_at}-${i}`}>
              <dt>{formatValue(p.kind)}</dt>
              <dd>
                {formatMinor(p.amount_minor, p.currency)} → {p.account.owner_type}:{p.account.kind}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
