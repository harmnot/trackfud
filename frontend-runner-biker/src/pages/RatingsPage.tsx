/**
 * Ratings received: Bayesian average, delivery count, topic tags.
 * Customer names are hidden by contract — tags only, never quotes.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Item, List, Page } from '../components/ui';
import { DEMO_RATINGS, fetchRatings, type RatingsSummary } from '../features/ratings/ratingsApi';
import { logger } from '../lib/logger';

export function RatingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<RatingsSummary | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setSummary(await fetchRatings());
      } catch (err) {
        logger.warn('ratings history failed, labelled sample owns the view', err);
        setSummary(DEMO_RATINGS);
      }
    })();
  }, []);

  return (
    <Page>
      <h1 className="tb-display">{t('ratings.title')}</h1>
      <p className="tb-sub">{t('ratings.private')}</p>
      {!summary && <p className="tb-sub mt-3">{t('common.loading')}</p>}
      {summary && summary.count === 0 && !summary.demo && (
        <div className="tb-card mt-3"><p className="tb-sub">{t('ratings.none')}</p></div>
      )}
      {summary && (summary.count > 0 || summary.demo) && (
        <>
          <div className="tb-timer mt-3">
            <p className="tb-run-hero">★ {summary.average.toFixed(1)}</p>
            <p className="tb-sub">{t('ratings.count', { count: summary.count })}</p>
            {summary.demo && <div className="mt-2"><Badge sun>{t('ratings.demo')}</Badge></div>}
          </div>
          {summary.tags.length > 0 && (
            <>
              <h2 className="tb-h2 mt-4">{t('ratings.tags')}</h2>
              <List className="flex flex-col gap-2 mt-2">
                {summary.tags.map((tag, i) => (
                  <Item key={tag.tag} index={i}>
                    <div className="tb-step-row">
                      <span className="tb-step-num">★</span>
                      <span>{tag.tag}</span>
                      <strong className="tb-tx-amt">×{tag.count}</strong>
                    </div>
                  </Item>
                ))}
              </List>
            </>
          )}
        </>
      )}
    </Page>
  );
}
