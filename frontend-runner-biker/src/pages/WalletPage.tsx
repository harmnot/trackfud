/**
 * Earnings wallet + "Earned & moved" summary, lifetime stats, WHO 150-min
 * ring, weekly AI coach report, and safety nudges (daily cap, rest day,
 * hydration done in-run). Balances are live from B5; the local ledger is
 * the offline mirror, honestly labelled.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Field, List, Item, Note, Page, Ring, Stat } from '../components/ui';
import { balanceMinor, useWallet } from '../features/wallet/walletStore';
import { fetchCoach, type CoachWeekly } from '../features/coach/coachApi';
import { activeSecondsToday, dayStreak, db, weeklyActiveMinutes, type SessionSummary } from '../lib/db';
import { DAILY_CAP_S, WHO_WEEKLY_GOAL_MIN, formatDistance, formatDuration, formatMoney, resolveUnits } from '../lib/format';
import { logger } from '../lib/logger';
import i18n from '../i18n';

export function WalletPage() {
  const { t } = useTranslation();
  const txs = useWallet((s) => s.txs);
  const currency = useWallet((s) => s.currency);
  const loaded = useWallet((s) => s.loaded);
  const server = useWallet((s) => s.server);
  const serverLoaded = useWallet((s) => s.serverLoaded);
  const [coach, setCoach] = useState<CoachWeekly | null>(null);
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState('');
  const [last, setLast] = useState<SessionSummary | null>(null);
  const [lifetime, setLifetime] = useState({ distanceM: 0, movingS: 0, sessions: 0, earned: 0 });
  const [weekMin, setWeekMin] = useState(0);
  const [capS, setCapS] = useState(0);
  const [streak, setStreak] = useState(0);

  const lang = i18n.language;
  const locale = lang === 'id' ? 'id-ID' : lang === 'ms' ? 'ms-MY' : 'en-GB';
  const units = resolveUnits(locale);

  useEffect(() => {
    void useWallet.getState().load();
    void (async () => {
      try {
        setCoach(await fetchCoach());
      } catch (err) {
        logger.warn('coach report failed, card stays hidden', err);
      }
    })();
    void (async () => {
      try {
        const sessions = await db.sessions.orderBy('startedAt').toArray();
        const latest = sessions[sessions.length - 1] ?? null;
        setLast(latest);
        setLifetime({
          distanceM: sessions.reduce((s, r) => s + r.distanceM, 0),
          movingS: sessions.reduce((s, r) => s + r.movingS, 0),
          sessions: sessions.length,
          earned: (await db.wallet.toArray()).filter((w) => w.kind === 'delivery').reduce((s, w) => s + w.amountMinor, 0),
        });
        setWeekMin((await weeklyActiveMinutes()).totalMin);
        setCapS(await activeSecondsToday());
        setStreak(await dayStreak());
      } catch (err) {
        logger.warn('wallet stats failed', err);
      }
    })();
  }, []);

  async function withdraw(): Promise<void> {
    const minor = Math.round(Number(amount));
    if (!Number.isFinite(minor) || minor <= 0) {
      setMsg(t('wallet.badAmount'));
      return;
    }
    // Real payout first (B5, idempotent); the labelled mock path only
    // runs while the backend is unreachable.
    const live = await useWallet.getState().withdrawReal({ amountMinor: minor, currency });
    if (live.ok) {
      setMsg(t('wallet.sent'));
      setAmount('');
      return;
    }
    if (live.reason !== 'offline-mock') {
      setMsg(t('wallet.lowBalance'));
      return;
    }
    const mock = await useWallet.getState().withdraw({ amountMinor: minor });
    setMsg(mock.ok ? `${t('wallet.sent')} · ${t('wallet.offline')}` : t('wallet.lowBalance'));
    if (mock.ok) setAmount('');
  }

  const bal = balanceMinor(txs);
  const liveBal = server.find((s) => s.currency === currency) ?? server[0] ?? null;

  return (
    <Page>
      <h1 className="tb-display">{t('wallet.title')}</h1>
      <div className="tb-timer mt-3">
        <p className="tb-run-hero">
          {liveBal && serverLoaded ? formatMoney(liveBal.balanceMinor, liveBal.currency, locale) : loaded ? formatMoney(bal, currency, locale) : '…'}
        </p>
        <p className="tb-sub">{liveBal && serverLoaded ? t('wallet.live') : t('wallet.mock')}</p>
        <div className="mt-2 flex gap-2">
          <div className="flex-1">
            <Field label={t('wallet.amount')}>
              <input
                className="tb-input"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                aria-label={t('wallet.amount')}
              />
            </Field>
          </div>
          <div className="flex-1 tb-withdraw-btn">
            <Button block variant="sun" onClick={() => void withdraw()}>{t('wallet.withdraw')}</Button>
          </div>
        </div>
        {msg && <div className="mt-2"><Note tone="info">{msg}</Note></div>}
      </div>

      {last && (
        <div className="tb-card mt-3">
          <p className="text-sm font-bold">{t('wallet.earnedMoved')}</p>
          <div className="tb-stats mt-2">
            <Stat value={formatDistance(last.distanceM, { locale, units })} label={t('fitness.distance')} />
            <Stat value={formatDuration(last.movingS)} label={t('fitness.moving')} />
            <Stat value={formatMoney(last.earningsMinor, last.currency, locale)} label={t('run.earned')} />
          </div>
          {last.gapCount > 0 && <p className="tb-sub mt-2">{t('run.gaps', { count: last.gapCount })}</p>}
        </div>
      )}

      <div className="tb-timer mt-3">
        <Ring progress={Math.min(1, weekMin / WHO_WEEKLY_GOAL_MIN)} center={`${Math.floor(weekMin)}′`} sub={` / ${WHO_WEEKLY_GOAL_MIN}′ WHO`} />
        <div className="tb-stats mt-3">
          <Stat value={formatDistance(lifetime.distanceM, { locale, units })} label={t('wallet.lifetime')} />
          <Stat value={formatDuration(lifetime.movingS)} label={t('fitness.moving')} />
          <Stat value={formatMoney(lifetime.earned, currency, locale)} label={t('run.earned')} />
        </div>
        {streak >= 6 && <div className="mt-2"><Note tone="info">{t('wallet.restDay')}</Note></div>}
        {capS >= DAILY_CAP_S && <div className="mt-2"><Note tone="error">{t('wallet.dailyCap')}</Note></div>}
      </div>

      {coach ? (
        <section className="tb-card mt-3" aria-label={t('coach.title')}>
          <p className="text-sm font-bold">{t('coach.title')}</p>
          <p className="mt-1 font-bold">{coach.headline}</p>
          <p className="tb-sub mt-1">{coach.body}</p>
          <p className="mt-2 text-sm font-bold">{t('coach.plan')}</p>
          <p className="tb-sub mt-1">{coach.next_plan}</p>
          <p className="tb-sub mt-2">{coach.advice_label}</p>
        </section>
      ) : null}

      <h2 className="tb-h2 mt-4">{t('wallet.history')}</h2>
      <List className="flex flex-col gap-2 mt-2">
        {txs.slice().reverse().slice(0, 20).map((w, i) => (
          <Item key={w.id} index={i}>
            <div className="tb-step-row">
              <span className="tb-step-num">{w.kind === 'withdraw' ? '↓' : '+'}</span>
              <span>{w.label}</span>
              <strong className="tb-tx-amt">{formatMoney(w.amountMinor, w.currency, locale)}</strong>
            </div>
          </Item>
        ))}
        {txs.length === 0 && <p className="tb-sub">{t('wallet.empty')}</p>}
      </List>
    </Page>
  );
}
