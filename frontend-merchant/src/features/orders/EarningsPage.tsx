/**
 * Merchant earnings: settled totals + weekly statements from GET /v1/merchant/earnings.
 * No local order math, no mocked payouts — every number is server-computed.
 * Responsive: totals stack on phones, two columns on tablet, three on desktop.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Item, List, Page } from '../../components/ui';
import { Note } from '../../components/ui';
import { fetchMerchantEarnings } from './earnings';
import { formatMinor } from './money';

const WEEKS = 8;

export default function EarningsPage() {
  const { t } = useTranslation();
  const earnings = useQuery({
    queryKey: ['merchant-earnings', WEEKS],
    queryFn: () => fetchMerchantEarnings({ weeks: WEEKS }),
  });

  return (
    <Page>
      <h1 className="tb-display">{t('earn.title')}</h1>
      <p className="tb-sub">{t('earn.sub')}</p>

      {earnings.isLoading ? (
        <div className="tb-skel mt-3" style={{ height: 180 }} />
      ) : earnings.isError ? (
        <div className="mt-3">
          <Note tone="error">
            {earnings.error instanceof Error ? earnings.error.message : t('common.error')}{' '}
            <button type="button" className="tb-link" onClick={() => void earnings.refetch()}>
              {t('common.retry', { defaultValue: 'Retry' })}
            </button>
          </Note>
        </div>
      ) : (
        <>
          {(earnings.data?.totals.length ?? 0) === 0 && (
            <div className="tb-quote mt-3">
              <p>“{t('earn.empty')}”</p>
              <small>{t('earn.emptySub')}</small>
            </div>
          )}
          <List className="flex flex-col gap-3 mt-3">
            {(earnings.data?.totals ?? []).map((tot, i) => (
              <Item key={tot.currency} index={i}>
                <article className="tb-card" aria-label={tot.currency}>
                  <p className="tb-order-row">
                    <strong>{formatMinor({ amountMinor: tot.net_minor, currency: tot.currency })}</strong>
                    <span className="tb-person-sub">{t('earn.orders', { n: tot.orders })}</span>
                  </p>
                  <p className="tb-person-sub">
                    {t('earn.gross', { v: formatMinor({ amountMinor: tot.gross_minor, currency: tot.currency }) })}
                    {' · '}
                    {t('earn.fee', { v: formatMinor({ amountMinor: tot.commission_minor, currency: tot.currency }) })}
                  </p>
                  {typeof tot.payable_minor === 'number' && (
                    <p className="tb-person-sub">
                      {t('earn.payable', {
                        defaultValue: 'payable {{v}}',
                        v: formatMinor({ amountMinor: tot.payable_minor, currency: tot.currency }),
                      })}
                    </p>
                  )}
                </article>
              </Item>
            ))}
          </List>

          {(earnings.data?.weeks.length ?? 0) > 0 && (
            <section aria-label={t('earn.weeks')}>
              <h2 className="tb-h2 tb-kitchen-h">{t('earn.weeks')}</h2>
              <List className="flex flex-col gap-2">
                {(earnings.data?.weeks ?? []).map((w, i) => (
                  <Item key={`${w.week_start}-${w.currency}`} index={i}>
                    <p className="tb-order-row">
                      <span>{t('earn.weekOf', { d: w.week_start })} · {t('earn.orders', { n: w.orders })}</span>
                      <strong>{formatMinor({ amountMinor: w.net_minor, currency: w.currency })}</strong>
                    </p>
                  </Item>
                ))}
              </List>
            </section>
          )}

          <div className="tb-quote mt-3">
            <p>“{t('earn.mockNote')}”</p>
            <small>{earnings.data?.payouts_note ?? t('earn.mockSub')}</small>
          </div>
        </>
      )}
    </Page>
  );
}
