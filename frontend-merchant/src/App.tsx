import { useEffect, useState } from "react";
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
import { api, savedUser, setSession, ApiError } from "./lib/api";
import {
    Badge,
    Button,
    Dropdown,
    Field,
    Item,
    List,
    Note,
    Page,
    Steps,
    Switch,
    faceColor,
    img,
} from "./components/ui";
import MenuPage from "./features/menu/MenuPage";
import ImportPage from "./features/menu/ImportPage";
import OrdersPage from "./features/orders/OrdersPage";
import EarningsPage from "./features/orders/EarningsPage";
import i18n from "./i18n";

type Merchant = {
    id: string;
    name: string;
    phone: string;
    country: string;
    currency: string;
    timezone: string;
    address: string;
    pickup_note: string;
    status: string;
    prep_minutes: number;
    lat: number;
    lng: number;
    opening_hours: Record<string, { open: string; close: string }>;
};
type Staff = {
    id: string;
    email: string;
    role: string;
    can_deliver: boolean;
    on_shift: boolean;
    status: string;
};

const ICONS: Record<string, React.ReactNode> = {
    shop: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 9l1.5-5h13L20 9" />
            <path d="M4 9v11h16V9" />
            <path d="M4 9h16" />
            <path d="M9 20v-6h6v6" />
        </svg>
    ),
    doc: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M6 2h9l5 5v15H6z" />
            <path d="M14 2v6h6" />
            <path d="M9 13h7M9 17h7" />
        </svg>
    ),
    team: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="9" cy="8" r="3.5" />
            <path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5" />
            <circle cx="17" cy="9" r="2.5" />
            <path d="M16 15c2.8.3 4.8 1.7 5.5 5" />
        </svg>
    ),
    flag: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M5 21V4" />
            <path d="M5 4h13l-2.5 4L18 12H5" />
        </svg>
    ),
    menu: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
    ),
    snap: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
        </svg>
    ),
    bell: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
            <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
    ),
    coins: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="9" cy="9" r="6" />
            <path d="M14.5 5.5h5.5v5.5" />
            <path d="M15 15l5 5" />
            <path d="M18 15v5h-5" />
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
    return (
        <div className="tb-shell">
            <header className="tb-topbar">
                <div className="tb-topbar-inner">
                    <Link
                        to="/setup"
                        className="tb-hello"
                        style={{ textDecoration: "none", color: "inherit" }}
                    >
                        <small>Trackfud · Merchant</small>
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
                                localStorage.setItem("tb:merchant:lang", v);
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
                    to="/setup"
                    aria-current={
                        loc.pathname === "/setup" ? "page" : undefined
                    }
                >
                    {ICONS.shop}
                    {t("nav.setup")}
                </Link>
                <Link
                    to="/orders"
                    aria-current={
                        loc.pathname === "/orders" ? "page" : undefined
                    }
                >
                    {ICONS.bell}
                    {t("nav.orders")}
                </Link>
                <Link
                    to="/earnings"
                    aria-current={
                        loc.pathname === "/earnings" ? "page" : undefined
                    }
                >
                    {ICONS.coins}
                    {t("nav.earn")}
                </Link>
                <Link
                    to="/menu"
                    aria-current={loc.pathname === "/menu" ? "page" : undefined}
                >
                    {ICONS.menu}
                    {t("nav.menu")}
                </Link>
                <Link
                    to="/menu/import"
                    aria-current={
                        loc.pathname === "/menu/import" ? "page" : undefined
                    }
                >
                    {ICONS.snap}
                    {t("nav.import")}
                </Link>
                <Link
                    to="/agreement"
                    aria-current={
                        loc.pathname === "/agreement" ? "page" : undefined
                    }
                >
                    {ICONS.doc}
                    {t("nav.agreement")}
                </Link>
                <Link
                    to="/staff"
                    aria-current={
                        loc.pathname === "/staff" ? "page" : undefined
                    }
                >
                    {ICONS.team}
                    {t("nav.staff")}
                </Link>
                <Link
                    to={user ? "/status" : "/login"}
                    aria-current={
                        loc.pathname === "/status" ? "page" : undefined
                    }
                >
                    {ICONS.flag}
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
            nav("/setup");
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
                    <img src={img("hero-chef.jpg")} alt="" />
                    <div className="tb-hero-body">
                        <span className="tb-kicker">{t("app.tagline")}</span>
                        <p className="tb-hero-title">
                            {mode === "login"
                                ? t("auth.login")
                                : t("auth.signup")}
                        </p>
                        <p className="tb-hero-sub">
                            Cook the food. Runners carry it with care.
                        </p>
                    </div>
                </div>
                <form
                    className="flex flex-col gap-3 mt-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void submit(
                            mode === "login" ? "/auth/login" : "/auth/signup",
                            { email, password, name, role: "merchant" },
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
                            placeholder="kitchen@example.com"
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
                            void submit("/auth/demo-login", { app: "merchant" })
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

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function Setup() {
    const { t } = useTranslation();
    const me = useQuery({
        queryKey: ["merchant-me"],
        queryFn: () =>
            api<{ merchant: Merchant | null }>("/merchant/merchants/me"),
    });
    const [form, setForm] = useState({
        name: "",
        phone: "",
        country: "ID",
        currency: "IDR",
        timezone: "Asia/Jakarta",
        address: "",
        pickup_note: "",
        lat: "-6.2088",
        lng: "106.8456",
        prep_minutes: 15,
    });
    const [hours, setHours] = useState<
        Record<string, { open: string; close: string }>
    >(() =>
        Object.fromEntries(
            DAYS.map((d) => [d, { open: "08:00", close: "21:00" }]),
        ),
    );
    const [search, setSearch] = useState("");
    const [msg, setMsg] = useState("");
    useEffect(() => {
        const m = me.data?.merchant;
        if (m) {
            setForm({
                name: m.name,
                phone: m.phone,
                country: m.country,
                currency: m.currency,
                timezone: m.timezone,
                address: m.address,
                pickup_note: m.pickup_note,
                lat: String(m.lat),
                lng: String(m.lng),
                prep_minutes: m.prep_minutes,
            });
            if (m.opening_hours && Object.keys(m.opening_hours).length)
                setHours(m.opening_hours);
        }
    }, [me.data]);
    function onMapClick(e: React.MouseEvent<HTMLDivElement>) {
        const rect = e.currentTarget.getBoundingClientRect();
        const dx = (e.clientX - rect.left) / rect.width - 0.5;
        const dy = (e.clientY - rect.top) / rect.height - 0.5;
        setForm((f) => ({
            ...f,
            lat: (parseFloat(f.lat) - dy * 0.02).toFixed(6),
            lng: (parseFloat(f.lng) + dx * 0.02).toFixed(6),
        }));
    }
    async function searchAddress() {
        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(search)}`,
            );
            const data = (await res.json()) as Array<{
                lat: string;
                lon: string;
                display_name: string;
            }>;
            if (data[0])
                setForm((f) => ({
                    ...f,
                    lat: data[0]!.lat,
                    lng: data[0]!.lon,
                    address: data[0]!.display_name,
                }));
            else setMsg("No result — type lat/lng manually.");
        } catch {
            setMsg("Address search offline — type lat/lng manually.");
        }
    }
    async function save() {
        const body = {
            ...form,
            lat: parseFloat(form.lat),
            lng: parseFloat(form.lng),
            opening_hours: hours,
        };
        try {
            if (me.data?.merchant)
                await api("/merchant/merchants/me", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
            else
                await api("/merchant/merchants", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": crypto.randomUUID(),
                    },
                    body: JSON.stringify(body),
                });
            setMsg(t("setup.saved"));
            void me.refetch();
        } catch (e) {
            setMsg(e instanceof ApiError ? e.message : t("common.error"));
        }
    }
    const step = me.data?.merchant
        ? me.data.merchant.status === "draft"
            ? 1
            : 2
        : 0;
    return (
        <Shell hello="Your kitchen">
            <Page>
                <h1 className="tb-display">{t("setup.title")}</h1>
                <p className="tb-sub">Three gentle steps to open your doors.</p>
                <Steps
                    total={3}
                    done={step}
                    labels={["Store", "Agreement", "Staff"]}
                />
                <div className="tb-store mt-3">
                    <div className="tb-store-img">
                        <img src={img("storefront.jpg")} alt="" />
                        {me.data?.merchant && (
                            <span
                                className="tb-kicker"
                                style={{
                                    position: "absolute",
                                    top: 12,
                                    left: 12,
                                    color: "#fff",
                                }}
                            >
                                {me.data.merchant.status}
                            </span>
                        )}
                    </div>
                    <div className="tb-store-body">
                        <p
                            className="font-extrabold text-lg"
                            style={{ letterSpacing: "-0.02em" }}
                        >
                            {form.name || "Your store name"}
                        </p>
                        <p className="tb-sub">
                            {form.address || "Add your address below"}
                        </p>
                    </div>
                </div>
                <List className="flex flex-col gap-3 mt-3">
                    <Item index={0}>
                        <Field label={t("setup.name")}>
                            <input
                                className="tb-input"
                                value={form.name}
                                onChange={(e) =>
                                    setForm({ ...form, name: e.target.value })
                                }
                            />
                        </Field>
                    </Item>
                    <Item index={1}>
                        <Field label={t("setup.phone")}>
                            <input
                                className="tb-input"
                                placeholder="+6221…"
                                value={form.phone}
                                onChange={(e) =>
                                    setForm({ ...form, phone: e.target.value })
                                }
                            />
                        </Field>
                    </Item>
                    <Item index={2}>
                        <div className="grid grid-cols-3 gap-2">
                            <Field label={t("setup.country")}>
                                <input
                                    className="tb-input"
                                    value={form.country}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            country: e.target.value,
                                        })
                                    }
                                />
                            </Field>
                            <Field label={t("setup.currency")}>
                                <input
                                    className="tb-input"
                                    value={form.currency}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            currency: e.target.value,
                                        })
                                    }
                                />
                            </Field>
                            <Field label={t("setup.timezone")}>
                                <input
                                    className="tb-input"
                                    value={form.timezone}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            timezone: e.target.value,
                                        })
                                    }
                                />
                            </Field>
                        </div>
                    </Item>
                    <Item index={3}>
                        <Field label={t("setup.address")}>
                            <input
                                className="tb-input"
                                value={form.address}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        address: e.target.value,
                                    })
                                }
                            />
                        </Field>
                    </Item>
                    <Item index={4}>
                        <span className="flex gap-2">
                            <input
                                className="tb-input"
                                placeholder="Search address…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                            <Button
                                type="button"
                                variant="soft"
                                onClick={() => void searchAddress()}
                            >
                                {t("setup.search")}
                            </Button>
                        </span>
                    </Item>
                    <Item index={5}>
                        <Button
                            variant="soft"
                            block
                            onClick={() =>
                                navigator.geolocation.getCurrentPosition((p) =>
                                    setForm((f) => ({
                                        ...f,
                                        lat: String(p.coords.latitude),
                                        lng: String(p.coords.longitude),
                                    })),
                                )
                            }
                        >
                            ◎ {t("setup.useMine")}
                        </Button>
                    </Item>
                    <Item index={6}>
                        <div
                            role="application"
                            aria-label="Pin map"
                            onClick={onMapClick}
                            className="tb-map"
                        >
                            <span className="tb-pin" aria-hidden>
                                📍
                            </span>
                            <p className="font-mono text-sm mt-1">
                                {form.lat}, {form.lng}
                            </p>
                            <p
                                className="text-xs mt-1"
                                style={{ opacity: 0.75 }}
                            >
                                {t("setup.pinHint")}
                            </p>
                        </div>
                    </Item>
                    <Item index={7}>
                        <div className="grid grid-cols-2 gap-2">
                            <Field label={t("setup.lat")}>
                                <input
                                    className="tb-input"
                                    value={form.lat}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            lat: e.target.value,
                                        })
                                    }
                                />
                            </Field>
                            <Field label={t("setup.lng")}>
                                <input
                                    className="tb-input"
                                    value={form.lng}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            lng: e.target.value,
                                        })
                                    }
                                />
                            </Field>
                        </div>
                    </Item>
                    <Item index={8}>
                        <Field label={t("setup.pickup")}>
                            <input
                                className="tb-input"
                                value={form.pickup_note}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        pickup_note: e.target.value,
                                    })
                                }
                            />
                        </Field>
                    </Item>
                    <Item index={9}>
                        <Field label={t("setup.prep")}>
                            <input
                                className="tb-input"
                                type="number"
                                min={5}
                                value={form.prep_minutes}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        prep_minutes:
                                            parseInt(e.target.value, 10) || 15,
                                    })
                                }
                            />
                        </Field>
                    </Item>
                    <Item index={10}>
                        <div className="tb-card">
                            <p className="font-extrabold mb-2">
                                {t("setup.hours")}
                            </p>
                            <div className="tb-hours">
                                {DAYS.map((d) => (
                                    <span key={d} className="tb-day">
                                        <span>{d}</span>
                                        <input
                                            className="tb-input"
                                            type="time"
                                            value={hours[d]?.open}
                                            onChange={(e) =>
                                                setHours({
                                                    ...hours,
                                                    [d]: {
                                                        open: e.target.value,
                                                        close:
                                                            hours[d]?.close ??
                                                            "21:00",
                                                    },
                                                })
                                            }
                                        />
                                        <input
                                            className="tb-input"
                                            type="time"
                                            value={hours[d]?.close}
                                            onChange={(e) =>
                                                setHours({
                                                    ...hours,
                                                    [d]: {
                                                        open:
                                                            hours[d]?.open ??
                                                            "08:00",
                                                        close: e.target.value,
                                                    },
                                                })
                                            }
                                        />
                                    </span>
                                ))}
                            </div>
                        </div>
                    </Item>
                </List>
                <div className="mt-3">
                    <Button block onClick={() => void save()}>
                        {t("setup.save")}
                    </Button>
                </div>
                {msg && (
                    <div className="mt-3">
                        <Note tone="info">{msg}</Note>
                    </div>
                )}
            </Page>
        </Shell>
    );
}

function Agreement() {
    const { t } = useTranslation();
    const ag = useQuery({
        queryKey: ["agreement"],
        queryFn: () =>
            api<{ version: string; text: string }>(
                "/merchant/agreement/current",
            ),
    });
    const [signer, setSigner] = useState("");
    const [tick, setTick] = useState(false);
    const [msg, setMsg] = useState("");
    async function sign() {
        try {
            await api("/merchant/merchants/me/agreement", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    signer_name: signer,
                    agreed: tick,
                    version: ag.data?.version,
                }),
            });
            setMsg(t("agree.done"));
        } catch (e) {
            setMsg(e instanceof ApiError ? e.message : t("common.error"));
        }
    }
    return (
        <Shell hello="Step two">
            <Page>
                <h1 className="tb-display">{t("agree.title")}</h1>
                <p className="tb-sub">A fair partnership, in plain words.</p>
                <Steps
                    total={3}
                    done={2}
                    labels={["Store", "Agreement", "Staff"]}
                />
                <div className="tb-hero mt-3" style={{ minHeight: 130 }}>
                    <img src={img("hero-chef.jpg")} alt="" />
                    <div className="tb-hero-body">
                        <span className="tb-kicker">
                            {ag.data?.version ?? "v1"}
                        </span>
                        <p
                            className="tb-hero-title"
                            style={{ fontSize: "1.3rem" }}
                        >
                            Partners, not just vendors
                        </p>
                    </div>
                </div>
                {ag.isLoading ? (
                    <div className="tb-skel mt-3" style={{ height: 200 }} />
                ) : (
                    <pre className="tb-doc mt-3">{ag.data?.text ?? ""}</pre>
                )}
                <div className="flex flex-col gap-3 mt-3">
                    <Field label={t("agree.signer")}>
                        <input
                            className="tb-input"
                            value={signer}
                            onChange={(e) => setSigner(e.target.value)}
                        />
                    </Field>
                    <label className="flex gap-2 items-start font-bold text-sm">
                        <input
                            type="checkbox"
                            checked={tick}
                            onChange={(e) => setTick(e.target.checked)}
                        />{" "}
                        {t("agree.tick")}
                    </label>
                    <Button
                        block
                        disabled={!tick || !signer}
                        onClick={() => void sign()}
                    >
                        {t("agree.sign")}
                    </Button>
                    {msg && <Note tone="info">{msg}</Note>}
                </div>
            </Page>
        </Shell>
    );
}

function StaffPage() {
    const { t } = useTranslation();
    const list = useQuery({
        queryKey: ["staff"],
        queryFn: () => api<{ staff: Staff[] }>("/merchant/staff"),
    });
    const [email, setEmail] = useState("");
    const [canDeliver, setCanDeliver] = useState(true);
    const [msg, setMsg] = useState("");
    async function invite() {
        try {
            await api("/merchant/staff/invite", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Idempotency-Key": crypto.randomUUID(),
                },
                body: JSON.stringify({
                    email,
                    can_deliver: canDeliver,
                    role: "staff",
                }),
            });
            setMsg(t("staff.sent"));
            void list.refetch();
        } catch (e) {
            setMsg(e instanceof ApiError ? e.message : t("common.error"));
        }
    }
    async function toggle(
        s: Staff,
        field: "can_deliver" | "on_shift",
        v: boolean,
    ) {
        await api(`/merchant/staff/${s.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [field]: v }),
        });
        void list.refetch();
    }
    return (
        <Shell hello="Your people">
            <Page>
                <h1 className="tb-display">{t("staff.title")}</h1>
                <p className="tb-sub">The hands your customers trust.</p>
                <div className="tb-hero mt-3" style={{ minHeight: 130 }}>
                    <img src={img("team.jpg")} alt="" />
                    <div className="tb-hero-body">
                        <span className="tb-kicker">
                            {(list.data?.staff ?? []).length} members
                        </span>
                        <p
                            className="tb-hero-title"
                            style={{ fontSize: "1.3rem" }}
                        >
                            Stronger together
                        </p>
                    </div>
                </div>
                <div className="tb-card mt-3 flex flex-col gap-3">
                    <Field label={t("staff.email")}>
                        <input
                            className="tb-input"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="teammate@example.com"
                        />
                    </Field>
                    <Switch
                        checked={canDeliver}
                        onChange={setCanDeliver}
                        label={t("staff.canDeliver")}
                    />
                    <Button block onClick={() => void invite()}>
                        {t("staff.send")}
                    </Button>
                    {msg && <Note tone="info">{msg}</Note>}
                </div>
                <List className="flex flex-col gap-2 mt-3">
                    {(list.data?.staff ?? []).map((s, i) => (
                        <Item key={s.id} index={i}>
                            <article className="tb-person">
                                <span
                                    className="tb-face"
                                    style={{ background: faceColor(s.email) }}
                                    aria-hidden
                                >
                                    {s.email.slice(0, 1).toUpperCase()}
                                </span>
                                <span className="tb-person-main">
                                    <span className="tb-person-name block">
                                        {s.email}
                                    </span>
                                    <span className="tb-person-sub">
                                        {s.role} · {s.status}
                                    </span>
                                </span>
                                <Badge green={s.on_shift}>
                                    {s.on_shift ? "ON SHIFT" : "OFF"}
                                </Badge>
                            </article>
                            <p className="flex gap-4 mt-2 ml-1 flex-wrap">
                                <Switch
                                    checked={s.can_deliver}
                                    onChange={(v) =>
                                        void toggle(s, "can_deliver", v)
                                    }
                                    label={t("staff.canDeliver")}
                                />
                                <Switch
                                    checked={s.on_shift}
                                    onChange={(v) =>
                                        void toggle(s, "on_shift", v)
                                    }
                                    label={t("staff.onShift")}
                                />
                            </p>
                        </Item>
                    ))}
                </List>
                {(list.data?.staff ?? []).length === 0 && (
                    <div className="tb-quote mt-3">
                        <p>
                            "Invite your first teammate — great kitchens are
                            never solo."
                        </p>
                        <small>Trackfud for teams</small>
                    </div>
                )}
            </Page>
        </Shell>
    );
}

function StatusPage() {
    const { t } = useTranslation();
    const me = useQuery({
        queryKey: ["merchant-status"],
        queryFn: () =>
            api<{ merchant: Merchant | null }>("/merchant/merchants/me"),
    });
    const done = me.data?.merchant
        ? me.data.merchant.status === "draft"
            ? 1
            : 3
        : 0;
    return (
        <Shell hello="Welcome">
            <Page>
                <h1 className="tb-display">{t("status.title")}</h1>
                <Steps
                    total={3}
                    done={done}
                    labels={["Store", "Agreement", "Staff"]}
                />
                <div className="tb-store mt-3">
                    <div className="tb-store-img">
                        <img src={img("storefront.jpg")} alt="" />
                    </div>
                    <div className="tb-store-body">
                        <p className="flex gap-2 items-center flex-wrap">
                            {me.data?.merchant ? (
                                <>
                                    <strong className="text-lg">
                                        {me.data.merchant.name}
                                    </strong>
                                    <Badge
                                        green={
                                            me.data.merchant.status !== "draft"
                                        }
                                    >
                                        {me.data.merchant.status}
                                    </Badge>
                                </>
                            ) : (
                                "No store yet. Complete Store setup first."
                            )}
                        </p>
                        <p className="tb-sub mt-1">{t("status.pending")}</p>
                        <p className="text-sm mt-1">{t("app.alerts")}</p>
                    </div>
                </div>
                <div className="tb-quote mt-3">
                    <p>"Cook with love. We will carry it with care."</p>
                    <small>The Trackfud promise</small>
                </div>
                <div className="mt-3">
                    <Button
                        variant="danger"
                        block
                        onClick={() => {
                            setSession(null);
                            location.href = "/merchant/login";
                        }}
                    >
                        {t("auth.logout")}
                    </Button>
                </div>
            </Page>
        </Shell>
    );
}

export default function App() {
    return (
        <Routes>
            <Route path="/" element={<Navigate to="/setup" replace />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route path="/setup" element={<Setup />} />
            <Route
                path="/menu"
                element={
                    <Shell hello="Your menu">
                        <MenuPage />
                    </Shell>
                }
            />
            <Route
                path="/menu/import"
                element={
                    <Shell hello="Snap it">
                        <ImportPage />
                    </Shell>
                }
            />
            <Route path="/agreement" element={<Agreement />} />
            <Route
                path="/orders"
                element={
                    <Shell hello="Kitchen live">
                        <OrdersPage />
                    </Shell>
                }
            />
            <Route
                path="/earnings"
                element={
                    <Shell hello="Your earnings">
                        <EarningsPage />
                    </Shell>
                }
            />
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="*" element={<Navigate to="/setup" replace />} />
        </Routes>
    );
}
