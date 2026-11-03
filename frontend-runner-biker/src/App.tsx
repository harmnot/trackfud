import { useEffect, useState } from "react";
import {
    Link,
    Navigate,
    Route,
    Routes,
    useLocation,
    useNavigate,
} from "react-router";
import { useTranslation } from "react-i18next";
import {
    api,
    savedUser,
    setSession,
    uploadViaPresign,
    ApiError,
} from "./lib/api";
import { activateUpdate, watchSwUpdates } from "./lib/swUpdate";
import { subscribeOfferPush } from "./lib/push";
import {
    Button,
    Dropdown,
    Field,
    FileUpload,
    Item,
    List,
    Note,
    Page,
    Ring,
    Stat,
    img,
} from "./components/ui";
import { RequireAuth } from "./features/auth/RequireAuth";
import { RequirePartner } from "./features/profile/RequirePartner";
import { usePartner } from "./features/profile/usePartner";
import { useRun } from "./features/run/sessionStore";
import { WorkSessionTracker } from "./features/run/WorkSessionTracker";
import { bindChatFrames } from "./features/chat/chatStore";
import { useStaff } from "./features/staff/staffStore";
import { StatusPage } from "./pages/StatusPage";
import { RunSetupPage } from "./pages/RunSetupPage";
import { RunModePage } from "./pages/RunModePage";
import { PlannerPage } from "./pages/PlannerPage";
import { DeliveryPage } from "./pages/DeliveryPage";
import { OrdersPage } from "./pages/OrdersPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { WalletPage } from "./pages/WalletPage";
import { StaffPage } from "./pages/StaffPage";
import { TracksPage } from "./pages/TracksPage";
import { ChatPage } from "./pages/ChatPage";
import { RatingsPage } from "./pages/RatingsPage";
import FitnessPage from "./features/fitness/FitnessPage";
import i18n from "./i18n";

const ICONS: Record<string, React.ReactNode> = {
    clip: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="5" y="4" width="14" height="17" rx="2" />
            <path d="M9 4a2 2 0 0 1 6 0" />
            <path d="M9 12h6M9 16h4" />
        </svg>
    ),
    check: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 12.5 9.5 18 20 6.5" />
        </svg>
    ),
    bolt: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
        </svg>
    ),
    medal: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="14" r="5" />
            <path d="M8.5 9.5 6 3h4l2 4 2-4h4l-2.5 6.5" />
        </svg>
    ),
    run: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="14" cy="4" r="2" />
            <path d="M6 20l3-5 2-4 3 2 3 1M9 11l3-2 2 3-1 4" />
        </svg>
    ),
    orders: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M8 6h13M8 12h13M8 18h13" />
            <path d="M3.5 6h0M3.5 12h0M3.5 18h0" />
        </svg>
    ),
    bag: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M6 8h12l-1 12H7L6 8z" />
            <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </svg>
    ),
    coin: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="8" />
            <path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4.5" />
        </svg>
    ),
};

function Shell({
    hello,
    children,
}: {
    hello: string;
    children: React.ReactNode;
}) {
    const { t } = useTranslation();
    const loc = useLocation();
    const user = savedUser();
    // Partner links stay hidden until the application state is known —
    // non-partners must never see delivery/wallet in the nav.
    const { unlocked: partnerUnlocked, partner, isLoading: partnerLoading } = usePartner({
        enabled: user !== null,
    });
    const partnerLinks = user !== null && !partnerLoading && partnerUnlocked;
    // PLAN §8.2: the fitness test is a one-time gate. Approved partners (and
    // on-shift staff, who skip it per §4.2) never see the fitness nav again.
    const staffActive = useStaff((s) => s.active);
    const runActive = useRun((s) => s.phase === "active");
    const hideFitness = partner === "approved" || staffActive;
    // While a work session is active the Run tab resumes it (/run). Going
    // back to /run-setup would open a second session, so the tab, the logo
    // and the route guard below all point at /run until End session.
    const runTo = runActive ? "/run" : "/run-setup";
    const [updateReady, setUpdateReady] = useState(false);
    useEffect(() => {
        watchSwUpdates(() => setUpdateReady(true));
    }, []);
    return (
        <div className="tb-shell">
            {updateReady && (
                <div className="tb-card mt-2" role="status">
                    <p className="text-sm font-bold">
                        {t("common.updateReady")}
                    </p>
                    <div className="mt-2">
                        <Button
                            variant="soft"
                            block
                            onClick={() => activateUpdate()}
                        >
                            {t("common.reload")}
                        </Button>
                    </div>
                </div>
            )}
            <header className="tb-topbar">
                <div className="tb-topbar-inner">
                    <Link
                        to={runTo}
                        className="tb-hello"
                        style={{ textDecoration: "none", color: "inherit" }}
                    >
                        <small>Trackfud · {t("app.brand")}</small>
                        <strong>{hello}</strong>
                    </Link>
                    {/* Account cluster is for signed-in users only. */}
                    {user !== null && (
                        <span className="flex items-center gap-2">
                            <Dropdown
                                label="Language"
                                value={i18n.language}
                                options={[
                                    { value: "en", label: "English" },
                                    { value: "id", label: "Indonesia" },
                                    { value: "ms", label: "Melayu" },
                                ]}
                                onChange={(v) => {
                                    localStorage.setItem("tb:courier:lang", v);
                                    void i18n.changeLanguage(v);
                                }}
                            />
                            <Link
                                to="/status"
                                className="tb-avatar"
                                aria-label={t("nav.status")}
                            >
                                {user.email.slice(0, 1).toUpperCase()}
                            </Link>
                        </span>
                    )}
                </div>
            </header>
            <main className="flex-1 px-4 pt-4 pb-28" key={loc.pathname}>
                {children}
            </main>
            {/* No navbar for guests; partner links only for approved partners/staff. */}
            {user !== null && (
                <nav className="tb-nav" aria-label="Main">
                    <Link
                        to={runTo}
                        aria-current={
                            loc.pathname.startsWith("/run") ? "page" : undefined
                        }
                    >
                        {ICONS.run}
                        {t("nav.run")}
                    </Link>
                    {partnerLinks && (
                        <Link
                            to="/delivery"
                            aria-current={
                                loc.pathname === "/delivery" ? "page" : undefined
                            }
                        >
                            {ICONS.bag}
                            {t("nav.delivery")}
                        </Link>
                    )}
                    {partnerLinks && (
                        <Link
                            to="/orders"
                            aria-current={
                                loc.pathname.startsWith("/orders")
                                    ? "page"
                                    : undefined
                            }
                        >
                            {ICONS.orders}
                            {t("nav.orders")}
                        </Link>
                    )}
                    {partnerLinks && (
                        <Link
                            to="/wallet"
                            aria-current={
                                loc.pathname === "/wallet" ? "page" : undefined
                            }
                        >
                            {ICONS.coin}
                            {t("nav.wallet")}
                        </Link>
                    )}
                    {/* Fitness is a one-time gate: hidden once approved or in staff
                        mode (PLAN §8.2 / §4.2). The /fitness route guard below
                        enforces the same rule for direct URL visits. */}
                    {!hideFitness && (
                        <Link
                            to="/fitness"
                            aria-current={
                                loc.pathname === "/fitness" ? "page" : undefined
                            }
                        >
                            {ICONS.bolt}
                            {t("nav.fitness")}
                        </Link>
                    )}
                    <Link
                        to="/status"
                        aria-current={
                            loc.pathname === "/status" ? "page" : undefined
                        }
                    >
                        {ICONS.medal}
                        {t("nav.status")}
                    </Link>
                </nav>
            )}
        </div>
    );
}

function AuthPage({ mode }: { mode: "login" | "signup" }) {
    const { t } = useTranslation();
    const nav = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    async function submit(path: string, body: object) {
        setErr("");
        setBusy(true);
        try {
            const d = await api<{
                access_token: string;
                user: { id: string; email: string; roles: string[] };
            }>(path, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            setSession({ accessToken: d.access_token, user: d.user });
            nav("/run-setup");
        } catch (e) {
            setErr(e instanceof ApiError ? e.message : t("common.error"));
        } finally {
            setBusy(false);
        }
    }
    return (
        <Shell hello={mode === "login" ? t("auth.login") : t("auth.signup")}>
            <Page>
                <div className="tb-hero">
                    <img src={img("hero-run.jpg")} alt="" />
                    <div className="tb-hero-body">
                        <span className="tb-kicker">{t("app.tagline")}</span>
                        <p className="tb-hero-title">
                            {mode === "login"
                                ? t("auth.login")
                                : t("auth.signup")}
                        </p>
                        <p className="tb-hero-sub">{t("app.safety")}</p>
                    </div>
                </div>
                <form
                    className="flex flex-col gap-3 mt-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void submit(
                            mode === "login" ? "/auth/login" : "/auth/signup",
                            // Ordinary account: no role is forced at signup
                            // (the server defaults it from the platform).
                            // Partner unlocks after onboarding + fitness
                            // test + CMS approval (see /onboarding).
                            mode === "login"
                                ? { email, password }
                                : { email, password, name },
                        );
                    }}
                >
                    {mode === "signup" && (
                        <Field label={t("auth.name")}>
                            <input
                                className="tb-input"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t("onboard.fullNamePh", { defaultValue: "e.g. Budi Santoso" })}
                                autoComplete="name"
                            />
                        </Field>
                    )}
                    <Field label={t("auth.email")}>
                        <input
                            className="tb-input"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                        />
                    </Field>
                    <Field label={t("auth.password")}>
                        <input
                            className="tb-input"
                            type="password"
                            required
                            minLength={8}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                        />
                    </Field>
                    {err && <Note tone="error">{err}</Note>}
                    <Button type="submit" block disabled={busy}>
                        {busy
                            ? "…"
                            : mode === "login"
                              ? t("auth.login")
                              : t("auth.signup")}
                    </Button>
                </form>
                <p className="mt-4 text-sm text-center font-bold">
                    <Link
                        to={mode === "login" ? "/signup" : "/login"}
                        className="underline"
                    >
                        {mode === "login" ? t("auth.signup") : t("auth.login")}
                    </Link>
                </p>
            </Page>
        </Shell>
    );
}

type Draft = {
    fullName: string;
    phone: string;
    idFileId: string;
    selfieFileId: string;
    bikeFileId: string;
    birthDate: string;
    nationality: string;
    city: string;
    country: string;
    emergencyName: string;
    emergencyPhone: string;
    idDocType: string;
    idNumber: string;
    bagLiters: string;
    bikeType: string;
};

const EMPTY_DRAFT: Draft = {
    fullName: "",
    phone: "",
    idFileId: "",
    selfieFileId: "",
    bikeFileId: "",
    birthDate: "",
    nationality: "",
    city: "",
    country: "",
    emergencyName: "",
    emergencyPhone: "",
    idDocType: "",
    idNumber: "",
    bagLiters: "",
    bikeType: "city",
};

function Onboarding() {
    const { t } = useTranslation();
    const [mode, setMode] = useState<"runner" | "biker">("runner");
    const [draft, setDraft] = useState<Draft>(() => {
        try {
            const saved = JSON.parse(
                localStorage.getItem("tb:courier:draft") ?? "null",
            ) as Partial<Draft> | null;
            return { ...EMPTY_DRAFT, ...(saved ?? {}) };
        } catch {
            return { ...EMPTY_DRAFT };
        }
    });
    const [msg, setMsg] = useState("");
    const [names, setNames] = useState<Partial<Record<keyof Draft, string>>>(
        {},
    );
    const [busyField, setBusyField] = useState<keyof Draft | null>(null);
    useEffect(() => {
        localStorage.setItem("tb:courier:draft", JSON.stringify(draft));
        const timer = setTimeout(() => {
            void api("/courier/application", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode, draft }),
            }).catch(() => undefined);
            // Partner profile powers CMS review + submit validation.
            void api("/courier/profile", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mode,
                    legal_name: draft.fullName,
                    birth_date: draft.birthDate,
                    nationality: draft.nationality,
                    address: { city: draft.city, country: draft.country },
                    emergency_contact: {
                        name: draft.emergencyName,
                        phone: draft.emergencyPhone,
                    },
                    phone: draft.phone,
                    id_doc_type: draft.idDocType,
                    id_number: draft.idNumber,
                    id_front_file_id: draft.idFileId,
                    id_back_file_id: draft.idFileId,
                    selfie_file_id: draft.selfieFileId,
                    bike:
                        mode === "biker"
                            ? {
                                  type: draft.bikeType,
                                  photo_file_id: draft.bikeFileId,
                                  no_motor: true,
                              }
                            : {},
                    bag_liters: parseInt(draft.bagLiters, 10) || 0,
                    consents: {
                        terms: { version: "v1", accepted_at: new Date().toISOString() },
                        privacy: { version: "v1", accepted_at: new Date().toISOString() },
                        location: { version: "v1", accepted_at: new Date().toISOString() },
                    },
                }),
            }).catch(() => undefined);
        }, 600);
        return () => clearTimeout(timer);
    }, [draft, mode]);
    useEffect(() => {
        void api<{ mode: string; draft: Draft }>("/courier/application")
            .then((d) => {
                if (d.draft?.fullName) setDraft(d.draft);
                if (d.mode === "biker" || d.mode === "runner") setMode(d.mode);
            })
            .catch(() => undefined);
    }, []);
    async function upload(field: keyof Draft, file: File) {
        setNames((n) => ({ ...n, [field]: file.name }));
        setBusyField(field);
        try {
            const id = await uploadViaPresign({ file, bucket: "private" });
            setDraft((d) => ({ ...d, [field]: id }));
            setMsg(t("onboard.uploaded"));
        } catch (e) {
            setMsg(e instanceof ApiError ? e.message : t("common.error"));
            setNames((n) => ({ ...n, [field]: undefined }));
        } finally {
            setBusyField(null);
        }
    }
    function clearFile(field: keyof Draft) {
        setDraft((d) => ({ ...d, [field]: "" }));
        setNames((n) => ({ ...n, [field]: undefined }));
    }
    const filled =
        [
            draft.fullName,
            draft.phone,
            draft.idFileId,
            draft.selfieFileId,
        ].filter(Boolean).length +
        (mode === "biker" ? (draft.bikeFileId ? 1 : 0) : 1);
    const total = mode === "biker" ? 5 : 4;
    return (
        <Shell hello="Good morning">
            <Page>
                <h1 className="tb-display">{t("onboard.title")}</h1>
                <p className="tb-sub">{t("onboard.saveDraft")}</p>
                <h2 className="tb-h2 mt-4">{t("onboard.mode")}</h2>
                <div
                    className="tb-modes mt-2"
                    role="radiogroup"
                    aria-label={t("onboard.mode")}
                >
                    <label className="tb-mode">
                        <input
                            type="radio"
                            name="mode"
                            checked={mode === "runner"}
                            onChange={() => setMode("runner")}
                        />
                        <span className="tb-mode-card">
                            <img src={img("hero-run.jpg")} alt="" />
                            <span>
                                {t("onboard.runner")}
                                <small>2 km · 15 min</small>
                            </span>
                        </span>
                    </label>
                    <label className="tb-mode">
                        <input
                            type="radio"
                            name="mode"
                            checked={mode === "biker"}
                            onChange={() => setMode("biker")}
                        />
                        <span className="tb-mode-card">
                            <img src={img("mode-bike.jpg")} alt="" />
                            <span>
                                {t("onboard.biker")}
                                <small>5 km · 20 min</small>
                            </span>
                        </span>
                    </label>
                </div>
                <div className="tb-stats mt-3">
                    <Stat value={`${filled}/${total}`} label="Profile" />
                    <Stat
                        value={mode === "runner" ? "2 km" : "5 km"}
                        label="Target"
                    />
                    <Stat
                        value={mode === "runner" ? "15′" : "20′"}
                        label="Limit"
                    />
                </div>
                <List className="flex flex-col gap-3 mt-4">
                    <Item index={0}>
                        <Field label={t("auth.name")}>
                            <input
                                className="tb-input"
                                value={draft.fullName}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        fullName: e.target.value,
                                    })
                                }
                                placeholder={t("onboard.fullNamePh", { defaultValue: "e.g. Budi Santoso" })}
                                autoComplete="name"
                            />
                        </Field>
                    </Item>
                    <Item index={1}>
                        <Field label={t("onboard.phone")}>
                            <input
                                className="tb-input"
                                placeholder="+62812…"
                                value={draft.phone}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        phone: e.target.value,
                                    })
                                }
                            />
                        </Field>
                    </Item>
                    <Item index={2}>
                        <p className="tb-sub">{t("onboard.profileHint")}</p>
                        <div className="flex flex-col gap-3 mt-2">
                            <Field label={t("onboard.birthDate")}>
                                <input className="tb-input" type="date" value={draft.birthDate} onChange={(e) => setDraft({ ...draft, birthDate: e.target.value })} aria-label={t("onboard.birthDate")} />
                            </Field>
                            <Field label={t("onboard.nationality")}>
                                <input className="tb-input" value={draft.nationality} onChange={(e) => setDraft({ ...draft, nationality: e.target.value })} placeholder={t("onboard.nationalityPh", { defaultValue: "e.g. Indonesian" })} />
                            </Field>
                            <Field label={t("onboard.city")}>
                                <input className="tb-input" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} placeholder={t("onboard.cityPh", { defaultValue: "e.g. Jakarta" })} autoComplete="address-level2" />
                            </Field>
                            <Field label={t("onboard.country")}>
                                <input className="tb-input" value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} placeholder={t("onboard.countryPh", { defaultValue: "e.g. Indonesia" })} autoComplete="country-name" />
                            </Field>
                            <Field label={t("onboard.emergencyName")}>
                                <input className="tb-input" value={draft.emergencyName} onChange={(e) => setDraft({ ...draft, emergencyName: e.target.value })} placeholder={t("onboard.emergencyNamePh", { defaultValue: "e.g. Siti Rahma" })} autoComplete="name" />
                            </Field>
                            <Field label={t("onboard.emergencyPhone")}>
                                <input className="tb-input" placeholder="+62812…" value={draft.emergencyPhone} onChange={(e) => setDraft({ ...draft, emergencyPhone: e.target.value })} inputMode="tel" autoComplete="tel" />
                            </Field>
                            <Field label={t("onboard.idType")}>
                                <input className="tb-input" value={draft.idDocType} onChange={(e) => setDraft({ ...draft, idDocType: e.target.value })} placeholder={t("onboard.idTypePh", { defaultValue: "e.g. KTP" })} />
                            </Field>
                            <Field label={t("onboard.idNumber")}>
                                <input className="tb-input" value={draft.idNumber} onChange={(e) => setDraft({ ...draft, idNumber: e.target.value })} placeholder={t("onboard.idNumberPh", { defaultValue: "e.g. 3174…" })} inputMode="numeric" />
                            </Field>
                            <Field label={t("onboard.bagLiters")}>
                                <input className="tb-input" inputMode="numeric" value={draft.bagLiters} onChange={(e) => setDraft({ ...draft, bagLiters: e.target.value })} placeholder={t("onboard.bagLitersPh", { defaultValue: "e.g. 25" })} />
                            </Field>
                            {mode === "biker" && (
                                <Field label={t("onboard.bikeType")}>
                                    <input className="tb-input" value={draft.bikeType} onChange={(e) => setDraft({ ...draft, bikeType: e.target.value })} placeholder="city" />
                                </Field>
                            )}
                        </div>
                    </Item>
                    <Item index={3}>
                        <p className="tb-label">{t("onboard.idPhoto")}</p>
                        <FileUpload
                            title="Drop your ID photo"
                            hint="or tap to browse · JPG/PNG, max 5 MB · stored private"
                            fileName={
                                names.idFileId ??
                                (draft.idFileId ? "id-photo.jpg" : null)
                            }
                            busy={busyField === "idFileId"}
                            done={Boolean(draft.idFileId)}
                            onFile={(f) => void upload("idFileId", f)}
                            onClear={() => clearFile("idFileId")}
                        />
                    </Item>
                    <Item index={4}>
                        <p className="tb-label">{t("onboard.selfie")}</p>
                        <FileUpload
                            title="Drop your selfie"
                            hint="or tap to browse · JPG/PNG, max 5 MB · stored private"
                            fileName={
                                names.selfieFileId ??
                                (draft.selfieFileId ? "selfie.jpg" : null)
                            }
                            busy={busyField === "selfieFileId"}
                            done={Boolean(draft.selfieFileId)}
                            onFile={(f) => void upload("selfieFileId", f)}
                            onClear={() => clearFile("selfieFileId")}
                        />
                    </Item>
                    {mode === "biker" && (
                        <Item index={5}>
                            <p className="tb-label">{t("onboard.bikePhoto")}</p>
                            <FileUpload
                                title="Drop your bike photo"
                                hint="or tap to browse · JPG/PNG, max 5 MB · stored private"
                                fileName={
                                    names.bikeFileId ??
                                    (draft.bikeFileId ? "bike.jpg" : null)
                                }
                                busy={busyField === "bikeFileId"}
                                done={Boolean(draft.bikeFileId)}
                                onFile={(f) => void upload("bikeFileId", f)}
                                onClear={() => clearFile("bikeFileId")}
                            />
                        </Item>
                    )}
                </List>
                {msg && (
                    <div className="mt-3">
                        <Note tone="info">{msg}</Note>
                    </div>
                )}
                <div className="tb-quote mt-4">
                    <p>
                        "Declining an offer is always okay — your workout comes
                        first."
                    </p>
                    <small>Trackfud promise</small>
                </div>
                <div className="mt-4">
                    <Link
                        to="/fitness"
                        className="tb-btn tb-btn-pine tb-btn-block"
                    >
                        {t("nav.fitness")} →
                    </Link>
                </div>
            </Page>
        </Shell>
    );
}

function Checklist() {
    const { t } = useTranslation();
    const [checks, setChecks] = useState<Record<string, boolean>>({});
    function set(k: string, v: boolean) {
        setChecks((c) => ({ ...c, [k]: v }));
    }
    // ✓ only once this device is registered for offer pushes: permission
    // alone delivers nothing. Denied/unsupported stay unchecked, silently.
    async function verifyPush(): Promise<void> {
        set("notif", (await subscribeOfferPush()) === "subscribed");
    }
    const rows: Array<{ key: string; label: string; run: () => void }> = [
        {
            key: "gps",
            label: t("check.gps"),
            run: () =>
                navigator.geolocation.getCurrentPosition(
                    () => set("gps", true),
                    () => set("gps", false),
                ),
        },
        {
            key: "wake",
            label: t("check.wake"),
            run: () => {
                const w = navigator as Navigator & {
                    wakeLock?: { request: (x: string) => Promise<unknown> };
                };
                if (w.wakeLock)
                    void w.wakeLock
                        .request("screen")
                        .then(() => set("wake", true))
                        .catch(() => set("wake", false));
                else set("wake", true);
            },
        },
        {
            key: "mic",
            label: t("check.mic"),
            run: () =>
                void navigator.mediaDevices
                    .getUserMedia({ audio: true })
                    .then(() => set("mic", true))
                    .catch(() => set("mic", false)),
        },
        {
            key: "notif",
            label: t("check.notif"),
            run: () => void verifyPush(),
        },
        {
            key: "motion",
            label: t("check.motion"),
            run: () => {
                const d = window as unknown as {
                    DeviceMotionEvent?: {
                        requestPermission?: () => Promise<string>;
                    };
                };
                if (d.DeviceMotionEvent?.requestPermission)
                    void d.DeviceMotionEvent.requestPermission().then((p) =>
                        set("motion", p === "granted"),
                    );
                else set("motion", true);
            },
        },
    ];
    const done = rows.filter((r) => checks[r.key]).length;
    return (
        <Shell hello="Prepare">
            <Page>
                <h1 className="tb-display">{t("check.title")}</h1>
                <p className="tb-sub">
                    {done} of {rows.length} ready — tap each to verify.
                </p>
                <div className="tb-hero mt-3" style={{ minHeight: 130 }}>
                    <img src={img("track.jpg")} alt="" />
                    <div className="tb-hero-body">
                        <span className="tb-kicker">
                            {done}/{rows.length} ready
                        </span>
                        <p
                            className="tb-hero-title"
                            style={{ fontSize: "1.25rem" }}
                        >
                            Your track is waiting
                        </p>
                    </div>
                </div>
                <List className="flex flex-col gap-2 mt-3">
                    {rows.map((r, i) => (
                        <Item key={r.key} index={i}>
                            <button
                                className={`tb-step-row${checks[r.key] ? " done" : ""}`}
                                onClick={r.run}
                            >
                                <span className="tb-step-num">
                                    {checks[r.key] ? "✓" : i + 1}
                                </span>
                                <span>{r.label}</span>
                            </button>
                        </Item>
                    ))}
                </List>
                <div className="mt-3">
                    <Button
                        block
                        variant="sun"
                        onClick={() => set("audio", true)}
                    >
                        {t("check.goOnline")} {checks.audio ? "✓" : ""}
                    </Button>
                </div>
                <p className="tb-sub mt-3">{t("check.install")}</p>
            </Page>
        </Shell>
    );
}

function Fitness() {
    return (
        <Shell hello="Session">
            <FitnessPage />
        </Shell>
    );
}

/**
 * While a work session is active the setup screen is unreachable: the Run
 * tab, the logo and direct URL visits all land on /run until End session.
 * This keeps one session per courier (PLAN §3) and matches the navbar.
 */
function RequireNoActiveRun({ children }: { children: React.ReactNode }) {
    const phase = useRun((s) => s.phase);
    if (phase === "active") return <Navigate to="/run" replace />;
    return <>{children}</>;
}

/**
 * Fitness is a one-time gate (PLAN §8.2): approved partners never see it
 * again, and staff skip it entirely (PLAN §4.2, invite-only fallback).
 * Direct /fitness visits redirect to /status like the hidden nav tab does.
 */
function RequireFitnessVisible({ children }: { children: React.ReactNode }) {
    const { t } = useTranslation();
    const { partner, isLoading } = usePartner();
    const staffActive = useStaff((s) => s.active);
    if (isLoading) {
        return (
            <Page>
                <div className="tb-skel" style={{ height: 120 }} role="status" aria-label={t("common.loading")} />
            </Page>
        );
    }
    if (partner === "approved" || staffActive) return <Navigate to="/status" replace />;
    return <>{children}</>;
}


export default function App() {
    // Chat lines + translations reach the store on every screen (idempotent).
    useEffect(() => bindChatFrames(), []);
    return (
        <>
            {/* Mounted once beside the routes: GPS + batched uploads keep
                streaming on every screen while a work session is active. */}
            <WorkSessionTracker />
            <AppRoutes />
        </>
    );
}

/** Route table: each screen with its auth/partner guards and shell. */
function AppRoutes() {
    return (
        <Routes>
            <Route path="/" element={<Navigate to="/run-setup" replace />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route
                path="/onboarding"
                element={
                    <RequireAuth>
                        <Onboarding />
                    </RequireAuth>
                }
            />
            <Route
                path="/checklist"
                element={
                    <RequireAuth>
                        <Checklist />
                    </RequireAuth>
                }
            />
            <Route
                path="/fitness"
                element={
                    <RequireAuth>
                        <RequireFitnessVisible>
                            <Fitness />
                        </RequireFitnessVisible>
                    </RequireAuth>
                }
            />
            <Route
                path="/status"
                element={
                    <RequireAuth>
                        <Shell hello="Account">
                            <StatusPage />
                        </Shell>
                    </RequireAuth>
                }
            />
            <Route
                path="/run-setup"
                element={
                    <RequireAuth>
                        <RequireNoActiveRun>
                            <Shell hello="Start">
                                <RunSetupPage />
                            </Shell>
                        </RequireNoActiveRun>
                    </RequireAuth>
                }
            />
            <Route
                path="/run"
                element={
                    <RequireAuth>
                        <Shell hello="Session">
                            <RunModePage />
                        </Shell>
                    </RequireAuth>
                }
            />
            <Route
                path="/planner"
                element={
                    <RequireAuth>
                        <Shell hello="AI Plan">
                            <PlannerPage />
                        </Shell>
                    </RequireAuth>
                }
            />
            <Route
                path="/delivery"
                element={
                    <RequireAuth>
                        <Shell hello="Delivery">
                            <DeliveryPage />
                        </Shell>
                    </RequireAuth>
                }
            />
            <Route
                path="/orders"
                element={
                    <RequireAuth>
                        <RequirePartner>
                            <Shell hello="Orders">
                                <OrdersPage />
                            </Shell>
                        </RequirePartner>
                    </RequireAuth>
                }
            />
            <Route
                path="/orders/:id"
                element={
                    <RequireAuth>
                        <RequirePartner>
                            <Shell hello="Orders">
                                <OrderDetailPage />
                            </Shell>
                        </RequirePartner>
                    </RequireAuth>
                }
            />
            <Route
                path="/wallet"
                element={
                    <RequireAuth>
                        <Shell hello="Wallet">
                            <WalletPage />
                        </Shell>
                    </RequireAuth>
                }
            />
            <Route
                path="/staff"
                element={
                    <RequireAuth>
                        <Shell hello="Staff">
                            <StaffPage />
                        </Shell>
                    </RequireAuth>
                }
            />
            <Route
                path="/tracks"
                element={
                    <RequireAuth>
                        <Shell hello="Tracks">
                            <TracksPage />
                        </Shell>
                    </RequireAuth>
                }
            />
            <Route
                path="/chat"
                element={
                    <RequireAuth>
                        <RequirePartner>
                            <Shell hello="Chat">
                                <ChatPage />
                            </Shell>
                        </RequirePartner>
                    </RequireAuth>
                }
            />
            <Route
                path="/ratings"
                element={
                    <RequireAuth>
                        <RequirePartner>
                            <Shell hello="Ratings">
                                <RatingsPage />
                            </Shell>
                        </RequirePartner>
                    </RequireAuth>
                }
            />
            <Route path="*" element={<Navigate to="/run-setup" replace />} />
        </Routes>
    );
}
