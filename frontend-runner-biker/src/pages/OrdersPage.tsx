/**
 * Courier Orders: every leg this courier carried — delivered and cancelled —
 * newest first. Scroll pagination (10 per page via an IntersectionObserver
 * sentinel), free-text search (order code / restaurant) and a terminal-state
 * filter. Partner-only: the route guard (`RequirePartner`) keeps this page to
 * approved partners and on-shift staff; the active leg still lives on
 * `/delivery`, linked from the banner while one is assigned.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  Button,
  Note,
  Page,
  RadioGroup,
  TextInput,
} from '../components/ui';
import { usePartner } from '../features/profile/usePartner';
import {
  fetchActiveDelivery,
  type DeliveryHistoryRow,
} from '../features/delivery/courierApi';
import {
  ORDERS_PER_PAGE,
  useCourierOrders,
} from '../features/orders/useCourierOrders';
import {
  formatDistance,
  formatDuration,
  formatMoney,
  formatSubmittedAt,
  resolveUnits,
} from '../lib/format';
import { logger } from '../lib/logger';
import i18n from '../i18n';

function statusTone(status: string): 'ok' | 'muted' {
  return status === 'delivered' ? 'ok' : 'muted';
}

function OrderCard(args: {
  row: DeliveryHistoryRow;
  locale: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { row, locale } = args;
  const units = resolveUnits(locale);
  const tone = statusTone(row.status);
  const when = row.delivered_at || row.created_at;
  const payoutMinor = row.payout?.amount_minor ?? 0;
  const currency = row.payout?.currency || 'IDR';
  return (
    <Link
      to={`/orders/${row.delivery_id}`}
      className="tb-order"
      aria-label={t('orders.openDetail', {
        code: row.order_code || row.merchant_name,
      })}
    >
      <span className="tb-order-top">
        <strong className="tb-order-merchant">{row.merchant_name || '—'}</strong>
        <span
          className={`tb-order-status is-${tone}`}
          data-status={row.status}
        >
          {row.status === 'delivered'
            ? t('orders.delivered')
            : t('orders.cancelled')}
        </span>
      </span>
      <span className="tb-order-sub">
        <span className="tb-order-code">
          #{row.order_code || row.delivery_id.slice(0, 8)}
        </span>
        {when && (
          <time dateTime={when}>{formatSubmittedAt(when)}</time>
        )}
      </span>
      <span className="tb-order-meta">
        <span className="tb-order-payout">
          {formatMoney(payoutMinor, currency, locale)}
        </span>
        <span>
          {formatDistance(row.distance_m || 0, { locale, units })}
          {' · '}
          {formatDuration(row.active_s || 0)}
        </span>
        {typeof row.courier_stars === 'number' && row.courier_stars >= 1 && (
          <span className="tb-order-stars" aria-label={t('orders.rated', { stars: row.courier_stars })}>
            ★ {row.courier_stars}
          </span>
        )}
      </span>
    </Link>
  );
}

function OrderSkeleton(): React.JSX.Element {
  return (
    <div className="tb-order is-skel" aria-hidden="true">
      <span className="tb-skel" style={{ height: 18, width: '55%' }} />
      <span className="tb-skel" style={{ height: 14, width: '40%' }} />
      <span className="tb-skel" style={{ height: 14, width: '75%' }} />
    </div>
  );
}

export function OrdersPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { unlocked, isLoading: partnerLoading } = usePartner();
  const enabled = !partnerLoading && unlocked;
  const list = useCourierOrders({ enabled });
  const lang = i18n.language;
  const locale = lang === 'id' ? 'id-ID' : lang === 'ms' ? 'ms-MY' : 'en-GB';
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [liveName, setLiveName] = useState<string | null>(null);

  // While a leg is assigned the detail work happens on /delivery — the
  // banner keeps one tap away without duplicating the handover flow.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      try {
        const env = await fetchActiveDelivery();
        if (live) setLiveName(env?.delivery.pickup.merchant_name ?? null);
      } catch (err) {
        logger.warn('orders live-leg check failed', err);
      }
    })();
    return () => {
      live = false;
    };
  }, [enabled]);

  // Infinite scroll: the sentinel refills the next page (10 rows).
  const { hasMore, loadMore } = list;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: '320px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  return (
    <Page>
      <h1 className="tb-display">{t('orders.title')}</h1>
      <p className="tb-sub">{t('orders.subtitle')}</p>

      {liveName && (
        <div className="mt-3">
          <Link to="/delivery" className="tb-order is-live" aria-label={t('orders.liveCta')}>
            <span className="tb-order-top">
              <strong className="tb-order-merchant">{liveName}</strong>
              <span className="tb-rec live">{t('orders.live')}</span>
            </span>
            <span className="tb-order-sub">{t('orders.liveBody')}</span>
          </Link>
        </div>
      )}

      <section className="tb-card mt-3" aria-label={t('orders.filterTitle')}>
        <TextInput
          label={t('orders.search')}
          type="search"
          value={list.query}
          onChange={list.setQuery}
          placeholder={t('orders.searchPh')}
          hint={t('orders.searchHint')}
          aria-label={t('orders.search')}
        />
        <div className="mt-2">
          <RadioGroup
            name="order-status"
            value={list.status}
            options={[
              { value: 'all', label: t('orders.all') },
              { value: 'delivered', label: t('orders.delivered') },
              { value: 'cancelled', label: t('orders.cancelled') },
            ]}
            onChange={(v) =>
              list.setStatus(v as 'all' | 'delivered' | 'cancelled')
            }
            ariaLabel={t('orders.filterTitle')}
          />
        </div>
      </section>

      <p className="tb-sub mt-3" role="status">
        {list.loading
          ? t('common.loading')
          : t('orders.count', { count: list.total })}
      </p>

      {list.failed ? (
        <div className="mt-3 flex flex-col gap-2">
          <Note tone="error">{t('orders.errorLoad')}</Note>
          <Button variant="soft" block onClick={list.retry}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {!list.failed && !list.loading && list.rows.length === 0 ? (
        <div className="tb-card mt-3">
          <p className="tb-sub">
            {list.query || list.status !== 'all'
              ? t('orders.emptySearch')
              : t('orders.empty')}
          </p>
        </div>
      ) : null}

      <div
        className="tb-orders-grid mt-2"
        aria-busy={list.loading || list.loadingMore}
      >
        {list.loading
          ? Array.from({ length: 4 }, (_, i) => <OrderSkeleton key={i} />)
          : list.rows.map((row) => (
              <OrderCard
                key={row.delivery_id}
                row={row}
                locale={locale}
              />
            ))}
      </div>

      {/* Sentinel refill: skeletons keep the layout stable while page N+1 loads. */}
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
      {list.loadingMore && (
        <div className="mt-2 flex flex-col gap-2" aria-label={t('common.loading')} role="status">
          <OrderSkeleton />
          <div className="tb-loader">
            <span className="tb-loader-spin" aria-hidden="true" />
          </div>
        </div>
      )}
      {!list.loading && !list.hasMore && list.rows.length >= ORDERS_PER_PAGE && (
        <p className="tb-sub mt-3" style={{ textAlign: 'center' }}>
          {t('orders.end')}
        </p>
      )}
    </Page>
  );
}
