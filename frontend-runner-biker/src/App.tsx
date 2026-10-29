import { useEffect, useRef, useState } from "react";
import {
    Link,
    Navigate,
    Route,
    Routes,
    useLocation,
    useNavigate,
} from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
    api,
    savedUser,
    setSession,
    uploadViaPresign,
    ApiError,
} from "./lib/api";
import { activateUpdate, watchSwUpdates } from "./lib/swUpdate";
import {
    Badge,
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
import { useStaff } from "./features/staff/staffStore";
import { StatusPage } from "./pages/StatusPage";
import { RunSetupPage } from "./pages/RunSetupPage";
import { RunModePage } from "./pages/RunModePage";
import { DeliveryPage } from "./pages/DeliveryPage";
import { WalletPage } from "./pages/WalletPage";
import { StaffPage } from "./pages/StaffPage";
import { TracksPage } from "./pages/TracksPage";
import { ChatPage } from "./pages/ChatPage";
import { RatingsPage } from "./pages/RatingsPage";
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
                        to="/run-setup"
                        className="tb-hello"
                        style={{ textDecoration: "none", color: "inherit" }}
                    >
                        <small>Trackfud · {t("app.brand")}</small>
                        <strong>{hello}</strong>
                    </Link>
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
                            to={user ? "/status" : "/login"}
                            className="tb-avatar"
                            aria-label={t("nav.status")}
                        >
                            {user ? user.email.slice(0, 1).toUpperCase() : "?"}
                        </Link>
                    </span>
                </div>
            </header>
            <main className="flex-1 px-4 pt-4 pb-28" key={loc.pathname}>
                {children}
            </main>
            <nav className="tb-nav" aria-label="Main">
                <Link
                    to="/run-setup"
                    aria-current={
                        loc.pathname.startsWith("/run") ? "page" : undefined
                    }
                >
                    {ICONS.run}
                    {t("nav.run")}
                </Link>
                <Link
                    to="/delivery"
                    aria-current={
                        loc.pathname === "/delivery" ? "page" : undefined
                    }
                >
                    {ICONS.bag}
                    {t("nav.delivery")}
                </Link>
                <Link
                    to="/wallet"
                    aria-current={
                        loc.pathname === "/wallet" ? "page" : undefined
                    }
                >
                    {ICONS.coin}
                    {t("nav.wallet")}
                </Link>
                <Link
                    to="/fitness"
                    aria-current={
                        loc.pathname === "/fitness" ? "page" : undefined
                    }
                >
                    {ICONS.bolt}
                    {t("nav.fitness")}
                </Link>
                <Link
                    to={user ? "/status" : "/login"}
                    aria-current={
                        loc.pathname === "/status" ? "page" : undefined
                    }
                >
                    {ICONS.medal}
                    {t("nav.status")}
                </Link>
            </nav>
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
                            // Ordinary Stride & Earn account: no partner role
                            // at signup. Partner unlocks after onboarding +
                            // fitness test + CMS approval (see /onboarding).
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
                <div className="mt-3">
                    <Button
                        variant="ink"
                        block
                        onClick={() =>
                            void submit("/auth/demo-login", { app: "courier" })
                        }
                    >
                        {t("auth.demo")}
                    </Button>
                </div>
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
                                <input className="tb-input" type="date" value={draft.birthDate} onChange={(e) => setDraft({ ...draft, birthDate: e.target.value })} />
                            </Field>
                            <Field label={t("onboard.nationality")}>
                                <input className="tb-input" value={draft.nationality} onChange={(e) => setDraft({ ...draft, nationality: e.target.value })} />
                            </Field>
                            <Field label={t("onboard.city")}>
                                <input className="tb-input" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
                            </Field>
                            <Field label={t("onboard.country")}>
                                <input className="tb-input" value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} />
                            </Field>
                            <Field label={t("onboard.emergencyName")}>
                                <input className="tb-input" value={draft.emergencyName} onChange={(e) => setDraft({ ...draft, emergencyName: e.target.value })} />
                            </Field>
                            <Field label={t("onboard.emergencyPhone")}>
                                <input className="tb-input" placeholder="+62812…" value={draft.emergencyPhone} onChange={(e) => setDraft({ ...draft, emergencyPhone: e.target.value })} />
                            </Field>
                            <Field label={t("onboard.idType")}>
                                <input className="tb-input" value={draft.idDocType} onChange={(e) => setDraft({ ...draft, idDocType: e.target.value })} />
                            </Field>
                            <Field label={t("onboard.idNumber")}>
                                <input className="tb-input" value={draft.idNumber} onChange={(e) => setDraft({ ...draft, idNumber: e.target.value })} />
                            </Field>
                            <Field label={t("onboard.bagLiters")}>
                                <input className="tb-input" inputMode="numeric" value={draft.bagLiters} onChange={(e) => setDraft({ ...draft, bagLiters: e.target.value })} />
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
            run: () =>
                void Notification.requestPermission().then((p) =>
                    set("notif", p === "granted"),
                ),
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

function haversine(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
): number {
    const R = 6371000;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((a.lat * Math.PI) / 180) *
            Math.cos((b.lat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
}

function Fitness() {
    const { t } = useTranslation();
    const cfg = useQuery({
        queryKey: ["cfg"],
        queryFn: () =>
            api<{
                fitness: {
                    runner_distance_m: number;
                    runner_moving_limit_s: number;
                    biker_distance_m: number;
                    biker_moving_limit_s: number;
                };
            }>("/config/public"),
    });
    const [recording, setRecording] = useState(false);
    const [dist, setDist] = useState(0);
    const [moving, setMoving] = useState(0);
    const [elapsed, setElapsed] = useState(0);
    const [points, setPoints] = useState(0);
    const [mode, setMode] = useState<"runner" | "biker">("runner");
    const [manual, setManual] = useState({ d: "2000", m: "800", e: "1000" });
    const [result, setResult] = useState("");
    const watch = useRef<number | null>(null);
    const last = useRef<{ lat: number; lng: number; ts: number } | null>(null);
    const startTs = useRef(0);
    useEffect(
        () => () => {
            if (watch.current !== null)
                navigator.geolocation.clearWatch(watch.current);
        },
        [],
    );
    function start() {
        setDist(0);
        setMoving(0);
        setElapsed(0);
        setPoints(0);
        last.current = null;
        startTs.current = Date.now();
        setRecording(true);
        watch.current = navigator.geolocation.watchPosition(
            (pos) => {
                const cur = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    ts: Date.now(),
                };
                setElapsed(Math.round((Date.now() - startTs.current) / 1000));
                if (last.current) {
                    const d = haversine(last.current, cur);
                    const dt = (cur.ts - last.current.ts) / 1000;
                    if (d > 1 && dt > 0) {
                        setDist((v) => v + d);
                        if (d / dt >= 0.8) setMoving((v) => v + Math.round(dt));
                    }
                }
                last.current = cur;
                setPoints((v) => v + 1);
            },
            undefined,
            { enableHighAccuracy: true },
        );
    }
    function stop() {
        if (watch.current !== null)
            navigator.geolocation.clearWatch(watch.current);
        setRecording(false);
    }
    async function submit(useManual: boolean) {
        const payload = useManual
            ? {
                  mode,
                  distance_m: parseFloat(manual.d),
                  moving_s: parseInt(manual.m, 10),
                  elapsed_s: parseInt(manual.e, 10),
                  points: 20,
              }
            : {
                  mode,
                  distance_m: Math.round(dist),
                  moving_s: moving,
                  elapsed_s: elapsed,
                  points,
              };
        try {
            const fit = await api<{ passed: boolean }>(
                "/courier/fitness-test",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                },
            );
            const sub = await api<{ status: string }>(
                "/courier/application/submit",
                { method: "POST" },
            );
            setResult(
                `${t("fitness.result")}: fitness ${fit.passed ? "PASS ✓" : "not yet"} · application ${sub.status}`,
            );
        } catch (e) {
            setResult(e instanceof ApiError ? e.message : t("common.error"));
        }
    }
    const staffActive = useStaff((s) => s.active);
    const target =
        mode === "biker"
            ? cfg.data?.fitness.biker_distance_m
            : cfg.data?.fitness.runner_distance_m;
    const progress = target ? Math.min(1, dist / target) : 0;
    const mm = String(Math.floor(moving / 60)).padStart(2, "0");
    const ss = String(moving % 60).padStart(2, "0");
    return (
        <Shell hello="Session">
            <Page>
                <h1 className="tb-display">{t("fitness.title")}</h1>
                <p className="tb-sub">
                    Target {target ?? "…"} m · {t("app.safety")}
                </p>
                {staffActive && (
                    <div className="mt-3">
                        <Note tone="info">{t("staff.noTest")}</Note>
                    </div>
                )}
                <div className="tb-timer mt-3">
                    {recording ? (
                        <p className="tb-rec live">Recording · {points} pts</p>
                    ) : (
                        <p className="tb-rec">Ready when you are</p>
                    )}
                    <div className="mt-3">
                        <Ring
                            progress={progress}
                            center={`${mm}:${ss}`}
                            sub="moving time"
                        />
                    </div>
                    <p className="mt-2 font-bold">
                        {Math.round(dist)} m · {elapsed}s elapsed
                    </p>
                </div>
                <div className="tb-stats mt-3">
                    <Stat
                        value={`${Math.round(dist)} m`}
                        label={t("fitness.distance")}
                    />
                    <Stat value={`${moving}s`} label={t("fitness.moving")} />
                    <Stat value={`${elapsed}s`} label={t("fitness.elapsed")} />
                </div>
                <div className="mt-2">
                    <p className="tb-label">{t("onboard.mode")}</p>
                    <Dropdown
                        label={t("onboard.mode")}
                        full
                        value={mode}
                        options={[
                            {
                                value: "runner",
                                label: "Runner",
                                sub: "2 km / 15 min",
                            },
                            {
                                value: "biker",
                                label: "Biker",
                                sub: "5 km / 20 min",
                            },
                        ]}
                        onChange={(v) => setMode(v as "runner" | "biker")}
                    />
                </div>
                <div className="flex gap-2 mt-3">
                    <div className="flex-1">
                        {!recording ? (
                            <Button block variant="sun" onClick={start}>
                                {t("fitness.start")}
                            </Button>
                        ) : (
                            <Button block variant="danger" onClick={stop}>
                                {t("fitness.stop")}
                            </Button>
                        )}
                    </div>
                    <div className="flex-1">
                        <Button
                            block
                            variant="soft"
                            onClick={() => void submit(false)}
                        >
                            {t("fitness.submit")}
                        </Button>
                    </div>
                </div>
                <p className="tb-sub mt-3">{t("fitness.checkpoint")}</p>
                <div className="tb-card mt-3">
                    <p className="text-sm font-bold">{t("fitness.desktop")}</p>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                        <Field label="Dist m">
                            <input
                                className="tb-input"
                                value={manual.d}
                                onChange={(e) =>
                                    setManual({ ...manual, d: e.target.value })
                                }
                            />
                        </Field>
                        <Field label="Move s">
                            <input
                                className="tb-input"
                                value={manual.m}
                                onChange={(e) =>
                                    setManual({ ...manual, m: e.target.value })
                                }
                            />
                        </Field>
                        <Field label="Elap s">
                            <input
                                className="tb-input"
                                value={manual.e}
                                onChange={(e) =>
                                    setManual({ ...manual, e: e.target.value })
                                }
                            />
                        </Field>
                    </div>
                    <div className="mt-2">
                        <Button
                            variant="soft"
                            block
                            onClick={() => void submit(true)}
                        >
                            {t("fitness.submit")} (desktop)
                        </Button>
                    </div>
                </div>
                {result && (
                    <div className="mt-3">
                        <Note tone="info">{result}</Note>
                    </div>
                )}
            </Page>
        </Shell>
    );
}


export default function App() {
    return (
        <Routes>
            <Route path="/" element={<Navigate to="/run-setup" replace />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/checklist" element={<Checklist />} />
            <Route path="/fitness" element={<Fitness />} />
            <Route
                path="/status"
                element={
                    <Shell hello="Account">
                        <StatusPage />
                    </Shell>
                }
            />
            <Route
                path="/run-setup"
                element={
                    <Shell hello="Start">
                        <RunSetupPage />
                    </Shell>
                }
            />
            <Route
                path="/run"
                element={
                    <Shell hello="Session">
                        <RunModePage />
                    </Shell>
                }
            />
            <Route
                path="/delivery"
                element={
                    <Shell hello="Delivery">
                        <DeliveryPage />
                    </Shell>
                }
            />
            <Route
                path="/wallet"
                element={
                    <Shell hello="Wallet">
                        <WalletPage />
                    </Shell>
                }
            />
            <Route
                path="/staff"
                element={
                    <Shell hello="Staff">
                        <StaffPage />
                    </Shell>
                }
            />
            <Route
                path="/tracks"
                element={
                    <Shell hello="Tracks">
                        <TracksPage />
                    </Shell>
                }
            />
            <Route
                path="/chat"
                element={
                    <Shell hello="Chat">
                        <ChatPage />
                    </Shell>
                }
            />
            <Route
                path="/ratings"
                element={
                    <Shell hello="Ratings">
                        <RatingsPage />
                    </Shell>
                }
            />
            <Route path="*" element={<Navigate to="/run-setup" replace />} />
        </Routes>
    );
}
