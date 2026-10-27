/**
 * Earnings + weekly statements, derived locally from the order list.
 * openapi.yaml has no merchant earnings/statement endpoint (only courier
 * `/v1/courier/earnings`), so settled totals come from accepted+ orders
 * minus commission; payouts stay mocked in demo (see note in UI).
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Item, List, Page } from '../../components/ui';
import { listOrders } from './api';
import { formatMinor, summarizeEarnings } from './money';

const WEEKS = 8;

/** Merchant earnings: settled totals, weekly statements, mock-payout note. */
export default function EarningsPage() {
  const { t } = useTranslation();
  const orders = useQuery({ queryKey: ['merchant-orders'], queryFn: listOrders });
  const summary = summarizeEarnings({ orders: orders.data ?? [], weeks: WEEKS });

  return (
    <Page>
      <h1 className="tb-display">{t('earn.title')}</h1>
      <p className="tb-sub">{t('earn.sub')}</p>

      {orders.isLoading ? (
        <div className="tb-skel mt-3" style={{ height: 180 }} />
      ) : (
        <>
          {summary.totals.length === 0 && (
            <div className="tb-quote mt-3">
              <p>“{t('earn.empty')}”</p>
              <small>{t('earn.emptySub')}</small>
            </div>
          )}
          <List className="flex flex-col gap-3 mt-3">
            {summary.totals.map((tot, i) => (
              <Item key={tot.currency} index={i}>
                <article className="tb-card" aria-label={tot.currency}>
                  <p className="tb-order-row">
                    <strong>{formatMinor({ amountMinor: tot.netMinor, currency: tot.currency })}</strong>
                    <span className="tb-person-sub">{t('earn.orders', { n: tot.orders })}</span>
                  </p>
                  <p className="tb-person-sub">
                    {t('earn.gross', { v: formatMinor({ amountMinor: tot.grossMinor, currency: tot.currency }) })}
                    {' · '}
                    {t('earn.fee', { v: formatMinor({ amountMinor: tot.commissionMinor, currency: tot.currency }) })}
                  </p>
                </article>
              </Item>
            ))}
          </List>

          {summary.weeks.length > 0 && (
            <section aria-label={t('earn.weeks')}>
              <h2 className="tb-h2 tb-kitchen-h">{t('earn.weeks')}</h2>
              <List className="flex flex-col gap-2">
                {summary.weeks.map((w, i) => (
                  <Item key={w.weekStart} index={i}>
                    <p className="tb-order-row">
                      <span>{t('earn.weekOf', { d: w.weekStart })} · {t('earn.orders', { n: w.orders })}</span>
                      <strong>{formatMinor({ amountMinor: w.netMinor, currency: w.currency })}</strong>
                    </p>
                  </Item>
                ))}
              </List>
            </section>
          )}

          <div className="tb-quote mt-3">
            <p>“{t('earn.mockNote')}”</p>
            <small>{t('earn.mockSub')}</small>
          </div>
        </>
      )}
    </Page>
  );
}
