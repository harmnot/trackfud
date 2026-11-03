/** Session start: run/ride, goal, track kind. Partner-gated extras below.
 *
 * Payout currency + Chat/Staff/Ratings shortcuts render only for approved
 * partners (or on-shift staff) — everyone else sees the workout setup plus a
 * partner CTA. Currencies and Paddle conversion come from the API
 * (`GET /fx/currencies`, `GET /fx/payout-info`); nothing is hardcoded.
 * Layout is single-column, min 44px targets, and wraps to two columns on
 * wide screens via the shared tb-* responsive grid.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router';
import { Button, Dropdown, Field, Note, Page, RadioGroup } from '../components/ui';
import { unlockAudio } from '../lib/notify';
import { subscribeOfferPush } from "../lib/push";
import { logger } from "../lib/logger";
import { ApiError } from "../lib/api";
import { useRun } from "../features/run/sessionStore";
import { startWorkSession } from "../features/run/sessionApi";
import { PlannerPanel } from "../features/planner/PlannerPanel";
import { usePlan } from "../features/planner/planStore";
import type { PlannerPlan } from "../features/planner/types";
import { useStaff } from "../features/staff/staffStore";
import { fetchMemberships } from "../features/delivery/courierApi";
import { useTracks } from "../features/tracks/trackStore";
import type { GoalKind, TrackKind } from "../features/run/types";
import type { CourierMode } from "../lib/format";
import { usePartner } from "../features/profile/usePartner";
import {
    fetchPayoutCurrencies,
    fetchPayoutInfo,
    type PayoutCurrency,
    type PayoutInfo,
} from "../features/payout/payoutApi";
import { fetchProfile } from "../features/profile/profileApi";

const DIST_GOALS = [3000, 5000, 10000];
const TIME_GOALS = [1800, 2700, 3600];

export function RunSetupPage() {
    const { t } = useTranslation();
    const nav = useNavigate();
    // Single active session per courier (PLAN §3): when a run is already live
    // this screen bounces back to /run — the courier must End session there
    // before starting a new one. The App route guard enforces the same rule.
    const runPhase = useRun((s) => s.phase);
    const start = useRun((s) => s.start);
    const [mode, setMode] = useState<CourierMode>("runner");
    const [goalKind, setGoalKind] = useState<GoalKind>("distance");
    const [goalValue, setGoalValue] = useState(5000);
    const [trackKind, setTrackKind] = useState<TrackKind>("free");
    const [trackId, setTrackId] = useState<string | null>(null);
    const staffActive = useStaff((s) => s.active);
    const tracks = useTracks((s) => s.tracks);
    const pickedPlan = usePlan((s) => s.picked);
    const pickPlan = usePlan((s) => s.pick);
    const [planDraft, setPlanDraft] = useState<PlannerPlan | null>(null);
    const activePlan = planDraft ?? pickedPlan;
    const {
        unlocked: isPartner,
        sanctioned,
        standing,
        isLoading: partnerLoading,
    } = usePartner();
    const [starting, setStarting] = useState(false);
    const [startErr, setStartErr] = useState("");
    useEffect(() => {
        void useTracks.getState().load();
    }, []);

    /**
     * Go online: the session opens server-side first so dispatch can score
     * the workout goal (free runs score GoalLeftM = 0, shorter preferred).
     * An AI plan travels as `planned_track` GeoJSON so dispatch scores the
     * corridor (§6.1); saved sketches stay device-local (null). A 403 means
     * the account is frozen/banned — stay put and say so. Any other failure
     * starts a device-local session whose GPS backlog auto-registers on
     * reconnect (offline path, honestly labelled).
     */
    async function begin(): Promise<void> {
        if (starting) return;
        unlockAudio();
        // Offer push opt-in rides the same tap (the prompt needs it). Never
        // awaited: it can't block or fail going online; outcomes are logged.
        void subscribeOfferPush();
        setStarting(true);
        setStartErr("");
        const goal = goalKind === "open" ? 0 : goalValue;
        const aiPlan = trackKind === "ai" ? activePlan : null;
        let sessionId: string | undefined;
        let serverLinked = true;
        try {
            const created = await startWorkSession({
                mode,
                goalKind,
                goalValue: goal,
                plannedTrack: aiPlan ? aiPlan.planned_track : null,
            });
            sessionId = created.sessionId;
        } catch (err) {
            if (err instanceof ApiError && err.status === 403) {
                setStartErr(
                    standing === "frozen" || standing === "banned"
                        ? t("account.frozen", {
                              defaultValue:
                                  "Your courier account is temporarily frozen — you cannot go online or receive offers. Contact the review team to appeal.",
                          })
                        : err.message,
                );
                setStarting(false);
                return;
            }
            logger.warn(
                "work session create failed, device-local fallback",
                err,
            );
            serverLinked = false;
        }
        if (aiPlan) pickPlan(aiPlan);
        start({
            setup: {
                mode,
                goalKind,
                goalValue: goal,
                trackKind,
                trackName:
                    trackKind === "saved"
                        ? (tracks.find((tr) => tr.id === trackId)?.name ?? null)
                        : activePlan
                          ? activePlan.name
                          : null,
                trackId: trackKind === "saved" ? trackId : null,
                plannedTrack: aiPlan ? aiPlan.planned_track : null,
                planId: aiPlan ? aiPlan.id : null,
                planName: aiPlan ? aiPlan.name : null,
            },
            sessionId,
            serverLinked,
        });
        setStarting(false);
        nav("/run");
    }

  const goalOptions =
    goalKind === 'time'
      ? TIME_GOALS.map((s) => ({ value: String(s), label: `${s / 60} min` }))
      : DIST_GOALS.map((m) => ({ value: String(m), label: `${m / 1000} km` }));

  if (runPhase === 'active') return <Navigate to="/run" replace />;

    return (
        <Page>
            <h1 className="tb-display">{t("run.setupTitle")}</h1>
            <p className="tb-sub">{t("app.safety")}</p>
            <div className="mt-3">
                <RadioGroup
                    name="rmode"
                    label={t("onboard.mode")}
                    value={mode}
                    onChange={(v) => setMode(v as CourierMode)}
                    options={[
                        { value: "runner", label: t("onboard.runner") },
                        { value: "biker", label: t("onboard.biker") },
                    ]}
                />
            </div>
            <div className="mt-3 flex flex-col gap-3">
                <Field label={t("run.goal")}>
                    <Dropdown
                        label={t("run.goal")}
                        full
                        value={goalKind}
                        options={[
                            { value: "distance", label: t("run.goalDistance") },
                            { value: "time", label: t("run.goalTime") },
                            { value: "open", label: t("run.goalOpen") },
                        ]}
                        onChange={(v) => setGoalKind(v as GoalKind)}
                    />
                </Field>
                {goalKind !== "open" && (
                    <Field label={t("run.target")}>
                        <Dropdown
                            label={t("run.target")}
                            full
                            value={String(goalValue)}
                            options={goalOptions}
                            onChange={(v) => setGoalValue(Number(v))}
                        />
                    </Field>
                )}
                <Field label={t("run.track")}>
                    <Dropdown
                        label={t("run.track")}
                        full
                        value={trackKind}
                        options={[
                            { value: "free", label: t("run.trackFree") },
                            { value: "saved", label: t("run.trackSaved") },
                            { value: "ai", label: t("run.trackAi") },
                        ]}
                        onChange={(v) => setTrackKind(v as TrackKind)}
                    />
                </Field>
                {trackKind === "ai" && (
                    <div className="tb-card">
                        <p className="text-sm font-bold">
                            {t("planner.inlineTitle")}
                        </p>
                        <p className="tb-sub mt-1">{t("planner.inlineSub")}</p>
                        {activePlan && (
                            <p className="tb-sub mt-1">
                                {t("planner.pickedInline", {
                                    name: activePlan.name,
                                })}
                            </p>
                        )}
                        <div className="mt-2 flex flex-col gap-2">
                            <Link
                                to="/planner"
                                className="tb-btn tb-btn-soft tb-btn-block"
                            >
                                {t("planner.open")}
                            </Link>
                            {activePlan && (
                                <Button
                                    block
                                    variant="soft"
                                    onClick={() => {
                                        setPlanDraft(null);
                                        pickPlan(null);
                                    }}
                                >
                                    {t("planner.clear")}
                                </Button>
                            )}
                        </div>
                        <div className="mt-3">
                            <PlannerPanel
                                mode={mode}
                                goalDistanceM={
                                    goalKind === "distance"
                                        ? goalValue
                                        : goalKind === "time"
                                          ? goalValue *
                                            (mode === "biker"
                                                ? 16 / 3.6
                                                : 9 / 3.6)
                                          : 5000
                                }
                                onPick={setPlanDraft}
                                pickedId={activePlan?.id ?? null}
                            />
                        </div>
                    </div>
                )}
                {trackKind === "saved" && (
                    <Field label={t("tracks.pick")}>
                        <Dropdown
                            label={t("tracks.pick")}
                            full
                            value={trackId ?? ""}
                            options={[
                                { value: "", label: t("tracks.none") },
                                ...tracks.map((tr) => ({
                                    value: tr.id,
                                    label: tr.name,
                                })),
                            ]}
                            onChange={(v) => setTrackId(v === "" ? null : v)}
                        />
                    </Field>
                )}
                {trackKind === "saved" && tracks.length === 0 && (
                    <Note tone="info">
                        {t("tracks.emptyShort")}{" "}
                        <Link to="/tracks" className="underline">
                            {t("tracks.title")}
                        </Link>
                    </Note>
                )}
                {staffActive && (
                    <Note tone="info">{t("staff.onDutyShort")}</Note>
                )}
                {!partnerLoading && isPartner && <PayoutCurrencyField />}
                {!partnerLoading && !isPartner && (
                    <Note tone="info">{t("account.deliveryLocked")}</Note>
                )}
            </div>
            {/* Go online is open to everyone (PLAN §2: open tracking, upgrade
              later): the server session + GPS buffer run device-local when the
              backend is unreachable, and dispatch only offers to approved
              partners or on-shift staff. Sanctioned accounts stay put (403). */}
          <div className="mt-4">
            <Button block variant="sun" onClick={() => void begin()} disabled={sanctioned || starting}>{starting ? t('common.loading') : t('run.start')}</Button>
          </div>
          {startErr && (
            <div className="mt-3">
              <Note tone="error">{startErr}</Note>
            </div>
          )}
          {!partnerLoading && sanctioned && (
            <Note tone="error">
              {standing === 'frozen'
                ? t('account.frozen', {
                    defaultValue:
                      'Your courier account is temporarily frozen — you cannot go online or receive offers. Contact the review team to appeal.',
                  })
                : t('account.banned', {
                    defaultValue:
                      'Your courier account is permanently closed. You cannot go online or receive offers.',
                  })}{' '}
              {t('account.sanctionWallet', {
                defaultValue: 'Money you already earned stays withdrawable.',
              })}
            </Note>
          )}
      {!partnerLoading && isPartner && <PartnerShortcuts />}
      {!partnerLoading && !isPartner && (
        <div className="mt-3 flex flex-col gap-2">
          <Link to="/onboarding" className="tb-btn tb-btn-pine tb-btn-block">{t('account.becomePartner')}</Link>
          <Link to="/tracks" className="tb-btn tb-btn-soft tb-btn-block">{t('tracks.title')}</Link>
        </div>
      )}
    </Page>
  );
}

/**
 * Partner-only payout currency picker: options and Paddle support come from
 * `GET /fx/currencies`; the settle note (direct vs converted to USD) comes
 * from `GET /fx/payout-info` with the live rate. Non-supported currencies
 * show the conversion so payouts stay accurate and up to date.
 */
function PayoutCurrencyField() {
  const { t } = useTranslation();
  const [currency, setCurrency] = useState(() => {
    try {
      return localStorage.getItem('tb:courier:currency') ?? '';
    } catch {
      return '';
    }
  });

  const profileQ = useQuery({ queryKey: ['partner-profile'], queryFn: fetchProfile, staleTime: 60_000 });
  const country =
    typeof profileQ.data?.profile?.address?.country === 'string'
      ? (profileQ.data.profile.address.country as string)
      : '';

  const currenciesQ = useQuery({
    queryKey: ['fx-currencies'],
    queryFn: fetchPayoutCurrencies,
    staleTime: 5 * 60_000,
  });
  const list: PayoutCurrency[] = currenciesQ.data ?? [];

  // Default to the profile country currency once both loads land.
  useEffect(() => {
    if (currency !== '' || list.length === 0) return;
    const fallback = country !== '' ? null : 'IDR';
    void fetchPayoutInfo({ country: country || undefined, currency: fallback ?? undefined })
      .then((info) => {
        setCurrency(info.country_currency);
        try {
          localStorage.setItem('tb:courier:currency', info.country_currency);
        } catch { /* private mode */ }
      })
      .catch((err: unknown) => logger.warn('payout default failed', err));
  }, [currency, list.length, country]);

  const infoQ = useQuery({
    queryKey: ['fx-payout-info', currency || country],
    queryFn: () => fetchPayoutInfo({ currency: currency || undefined, country: currency ? undefined : country || undefined }),
    enabled: currency !== '' || country !== '',
    staleTime: 60_000,
  });
  const info: PayoutInfo | undefined = infoQ.data;

  function pick(next: string): void {
    setCurrency(next);
    try {
      localStorage.setItem('tb:courier:currency', next);
    } catch { /* demo pref only */ }
  }

  if (currenciesQ.isLoading) {
    return <p className="tb-sub">{t("common.loading")}</p>;
  }
  if (currenciesQ.isError || list.length === 0) {
    return <Note tone="error">{t("common.error")}</Note>;
  }
  return (
    <Field label={t("run.currency")}>
      <Dropdown
        label={t("run.currency")}
        full
        value={currency}
        options={list.map((c) => ({
          value: c.code,
          label: c.paddle_supported ? c.code : `${c.code} → USD`,
          sub: c.paddle_supported ? "Paddle" : "converts",
        }))}
        onChange={pick}
      />
      {info && !info.paddle_supported && (
        <Note tone="info" className="mt-3">
          {t("run.currencyConverts", {
            from: info.country_currency,
            to: info.settle_currency,
            rate: info.rate,
            defaultValue: `${info.country_currency} is not settled by Paddle, so payouts convert to ${info.settle_currency} at ${info.rate}.`,
          })}
        </Note>
      )}
      {info && info.paddle_supported && (
        <p className="tb-sub mt-3">
          {t("run.currencyDirect", {
            currency: info.settle_currency,
            defaultValue: `Paddle settles ${info.settle_currency} directly.`,
          })}
        </p>
      )}
    </Field>
  );
}

/**
 * Partner-only shortcuts: Chat, Tracks and My Ratings for everyone approved,
 * plus Staff Mode ONLY for invited staff (PLAN §3 staff fallback: the
 * merchant invites by email, `GET /courier/staff/memberships` is the truth).
 * Non-invited partners never see the Staff button here — the /staff page
 * itself still explains how to get invited.
 */
function PartnerShortcuts() {
    const { t } = useTranslation();
    const staffActive = useStaff((s) => s.active);
    const membersQ = useQuery({
        queryKey: ["staff-memberships-shortcut"],
        queryFn: fetchMemberships,
        staleTime: 60_000,
        retry: false,
    });
    const hasInvite = (membersQ.data ?? []).length > 0;
    const showStaff = staffActive || hasInvite;
    return (
        <div className="mt-3 flex flex-col gap-2">
            {showStaff && (
                <Link to="/staff" className="tb-btn tb-btn-soft tb-btn-block">
                    {t("staff.title")}
                </Link>
            )}
            <Link to="/planner" className="tb-btn tb-btn-soft tb-btn-block">
                {t("planner.title")}
            </Link>
            <Link to="/tracks" className="tb-btn tb-btn-soft tb-btn-block">
                {t("tracks.title")}
            </Link>
            <Link to="/chat" className="tb-btn tb-btn-soft tb-btn-block">
                {t("chat.title")}
            </Link>
            <Link to="/ratings" className="tb-btn tb-btn-soft tb-btn-block">
                {t("ratings.title")}
            </Link>
        </div>
    );
}
