/**
 * Ratings received: average + count from the live delivery history API.
 * Customer names are hidden by contract — tags only, never quotes.
 * Failures show an error + retry; sample data lives only in unit tests.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Item, List, Note, Page } from '../components/ui';
import { fetchRatings, type RatingsSummary } from '../features/ratings/ratingsApi';
import { logger } from '../lib/logger';

export function RatingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<RatingsSummary | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setFailed(false);
    try {
      setSummary(await fetchRatings());
    } catch (err) {
      logger.warn('ratings history failed', err);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Page>
      <h1 className="tb-display">{t('ratings.title')}</h1>
      <p className="tb-sub">{t('ratings.private')}</p>
      {!summary && !failed && <p className="tb-sub mt-3">{t('common.loading')}</p>}
      {failed && (
        <div className="mt-3 flex flex-col gap-2">
          <Note tone="error">{t('ratings.errorLoad')}</Note>
          <Button variant="soft" block onClick={() => void load()}>{t('common.retry')}</Button>
        </div>
      )}
      {summary && summary.count === 0 && (
        <div className="tb-card mt-3"><p className="tb-sub">{t('ratings.none')}</p></div>
      )}
      {summary && summary.count > 0 && (
        <>
          <div className="tb-timer mt-3">
            <p className="tb-run-hero">★ {summary.average.toFixed(1)}</p>
            <p className="tb-sub">{t('ratings.count', { count: summary.count })}</p>
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
