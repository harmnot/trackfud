import { useEffect, useState } from "react";
import {
    Link,
    Navigate,
    Route,
    Routes,
    useLocation,
    useNavigate,
    useParams,
} from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, logout, savedUser, setSession, wsTicket, ApiError } from "./lib/api";
import { formatDistance, formatMoney } from "./lib/format";
import { useCart } from "./lib/store";
import {
    Button,
    Dropdown,
    Field,
    Item,
    List,
    Note,
    Page,
    Skeleton,
    Tag,
    bannerImage,
    dishImage,
    img,
} from "./components/ui";
import { RestaurantRating } from "./features/catalog/RestaurantRating";
import { AddressesPage } from "./features/addresses/AddressesPage";
import { useDeliveryLocation } from "./features/addresses/useDeliveryLocation";
import { RequireAuth } from "./features/auth/RequireAuth";
import {
    useCustomerCategories,
    useMenu,
    useRestaurant,
    useRestaurants,
} from "./features/catalog/hooks";
import { categoryLabel } from "./features/catalog/types";
import { AvailabilityBadge } from "./features/catalog/AvailabilityBadge";
import { CheckoutPage } from "./features/orders/CheckoutPage";
import { getFxPreview, getWallet } from "./features/orders/api";
import { PayError, topUpWithPaddle } from "./features/orders/pay";
import { ImpactPage, ImpactQuote } from "./features/postdelivery/ImpactCard";
import { SyncBadge } from "./features/postdelivery/ReceiptSync";
import { OrderPage, OrdersPage } from "./features/tracking/OrderPage";
import i18n from "./i18n";

const ICONS: Record<string, React.ReactNode> = {
    home: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V21h14V9.5" />
        </svg>
    ),
    pin: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
            <circle cx="12" cy="10" r="2.5" />
        </svg>
    ),
    cart: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3 4h2l2.4 12.2A1.5 1.5 0 0 0 8.9 17.5H19a1.5 1.5 0 0 0 1.5-1.2L22 8H6" />
            <circle cx="10" cy="21" r="1.4" />
            <circle cx="18" cy="21" r="1.4" />
        </svg>
    ),
    user: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5" />
        </svg>
    ),
    search: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
        >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
        </svg>
    ),
    bolt: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
        </svg>
    ),
};

function Shell({ children }: { children: React.ReactNode }) {
    const { t } = useTranslation();
    const loc = useLocation();
    const cart = useCart((s) => s.items.reduce((n, i) => n + i.qty, 0));
    const user = savedUser();
    const delivery = useDeliveryLocation();
    const topLabel = delivery.activeAddress
        ? delivery.activeAddress.address
            ? `${delivery.activeAddress.label} · ${delivery.activeAddress.address}`
            : delivery.activeAddress.label
        : delivery.source === "device"
          ? `${delivery.loc.lat.toFixed(4)}, ${delivery.loc.lng.toFixed(4)}`
          : null;
    const topTitle = delivery.activeAddress
        ? [
              delivery.activeAddress.label,
              delivery.activeAddress.address,
              delivery.activeAddress.note,
          ]
              .filter(Boolean)
              .join(" · ")
        : (topLabel ?? `Trackfud · ${t("app.tagline")}`);
    return (
        <div className="tb-shell">
            <header className="tb-topbar">
                <div className="tb-topbar-inner">
                    <Link
                        to="/location"
                        className="tb-loc"
                        aria-label={t("nav.location")}
                    >
                        <span className="tb-loc-badge">
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
                                <circle cx="12" cy="10" r="2.5" />
                            </svg>
                        </span>
                        <span>
                            <small>{t("nav.location")}</small>
                            <strong title={topTitle}>
                                {topLabel ?? (
                                    <>
                                        Trackfud · {t("app.tagline")}
                                    </>
                                )}
                            </strong>
                        </span>
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
                                    localStorage.setItem("tb:customer:lang", v);
                                    void i18n.changeLanguage(v);
                                }}
                            />
                            <Link
                                to="/profile"
                                className="tb-avatar"
                                aria-label={t("nav.profile")}
                            >
                                {user.email.slice(0, 1).toUpperCase()}
                            </Link>
                        </span>
                    )}
                </div>
                <SyncBadge />
            </header>
            <main className="flex-1 px-4 pt-4 pb-28" key={loc.pathname}>
                {children}
            </main>
            {/* No navbar for guests. */}
            {user !== null && (
                <nav className="tb-nav" aria-label="Main">
                    <Link
                        to="/"
                        aria-current={loc.pathname === "/" ? "page" : undefined}
                    >
                        {ICONS.home}
                        {t("nav.home")}
                    </Link>
                    <Link
                        to="/location"
                        aria-current={
                            loc.pathname === "/location" ? "page" : undefined
                        }
                    >
                        {ICONS.pin}
                        {t("nav.location")}
                    </Link>
                    <Link
                        to="/cart"
                        aria-current={loc.pathname === "/cart" ? "page" : undefined}
                    >
                        <span style={{ position: "relative", display: "flex" }}>
                            {ICONS.cart}
                            {cart > 0 && (
                                <span className="tb-count" key={cart}>
                                    {cart}
                                </span>
                            )}
                        </span>
                        {t("nav.cart")}
                    </Link>
                    <Link
                        to="/profile"
                        aria-current={
                            loc.pathname === "/profile" ? "page" : undefined
                        }
                    >
                        {ICONS.user}
                        {t("nav.profile")}
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
            nav("/");
        } catch (e) {
            setErr(e instanceof ApiError ? e.message : t("common.error"));
        } finally {
            setBusy(false);
        }
    }
    return (
        <Shell>
            <Page>
                <div className="tb-auth-art">
                    <img src={img("banner-jakarta.jpg")} alt="" />
                    <div>
                        <p className="tb-promo-kicker">Trackfud</p>
                        <h1 className="tb-display mt-1">
                            {mode === "login"
                                ? t("auth.login")
                                : t("auth.signup")}
                        </h1>
                        <p className="tb-promo-sub">{t("app.promise")}</p>
                    </div>
                </div>
                <form
                    className="flex flex-col gap-3 mt-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void submit(
                            mode === "login" ? "/auth/login" : "/auth/signup",
                            { email, password, name, role: "customer" },
                        );
                    }}
                >
                    {mode === "signup" && (
                        <Field label={t("auth.name")}>
                            <input
                                className="tb-input"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                autoComplete="name"
                                placeholder={t("auth.namePh", { defaultValue: "e.g. Budi Santoso" })}
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
                            autoComplete="email"
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
                            autoComplete="current-password"
                            placeholder="••••••••"
                        />
                    </Field>
                    {err && <Note tone="error">{err}</Note>}
                    <Button type="submit" variant="ember" block disabled={busy}>
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

function Home() {
    const { t } = useTranslation();
    const delivery = useDeliveryLocation();
    const { lat, lng } = delivery.loc;
    const hasPoint = delivery.source !== "fallback";
    const pointLabel = delivery.activeAddress
        ? delivery.activeAddress.address
            ? `${delivery.activeAddress.label} · ${delivery.activeAddress.address}`
            : delivery.activeAddress.label
        : delivery.source === "device"
          ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
          : null;
    const [search, setSearch] = useState("");
    // Empty string = "All". Otherwise the category label; the restaurant
    // list is narrowed server-side (`GET /v1/customer/restaurants?category=`).
    const [cat, setCat] = useState("");
    const cats = useCustomerCategories();
    const q = useRestaurants({ lat, lng, category: cat });
    const cartCount = useCart((s) => s.items.reduce((n, i) => n + i.qty, 0));
    const cartTotal = useCart((s) =>
        s.items.reduce((n, i) => n + i.priceMinor * i.qty, 0),
    );
    const cartCur = useCart((s) => s.items[0]?.currency ?? "IDR");
    const shops = (q.data ?? []).filter((r) =>
        r.name.toLowerCase().includes(search.toLowerCase()),
    );
    return (
        <Shell>
            <Page>
                <h1 className="tb-display">{t("home.title")}</h1>
                <p className="tb-sub">{t("home.nearYou")}</p>
                <div className="tb-search mt-3">
                    {ICONS.search}
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search restaurants…"
                        aria-label="Search restaurants"
                    />
                </div>
                <div className="tb-promo mt-3">
                    <img src={img("hero-run.jpg")} alt="" />
                    <div className="tb-promo-body">
                        <span className="tb-promo-kicker">
                            <span
                                style={{
                                    width: 14,
                                    height: 14,
                                    display: "inline-flex",
                                }}
                            >
                                {ICONS.bolt}
                            </span>{" "}
                            30–60 min · workout delivery
                        </span>
                        <p className="tb-promo-title">
                            Food that moves with runners
                        </p>
                        <p className="tb-promo-sub">
                            Carried on a real morning run, not a motorbike.
                        </p>
                    </div>
                </div>
                <div className="tb-stats mt-3">
                    <div className="tb-stat">
                        <strong>{shops.length}</strong>
                        <span>nearby</span>
                    </div>
                    <div className="tb-stat">
                        <strong>30–60′</strong>
                        <span>promise</span>
                    </div>
                    <div className="tb-stat">
                        <strong>★ 4.7</strong>
                        <span>avg rating</span>
                    </div>
                </div>
                <div
                    className="tb-chips mt-3"
                    role="tablist"
                    aria-label={t("home.categories")}
                >
                    <button
                        role="tab"
                        aria-selected={cat === ""}
                        className={`tb-chip${cat === "" ? " on" : ""}`}
                        onClick={() => setCat("")}
                    >
                        {t("home.all")}
                    </button>
                    {cats.isLoading &&
                        [0, 1, 2].map((i) => (
                            <span
                                key={i}
                                className="tb-chip"
                                aria-hidden="true"
                                style={{ opacity: 0.5 }}
                            >
                                …
                            </span>
                        ))}
                    {(cats.data ?? []).map((c) => (
                        <button
                            key={c.label}
                            role="tab"
                            aria-selected={cat === c.label}
                            className={`tb-chip${cat === c.label ? " on" : ""}`}
                            onClick={() =>
                                setCat((cur) => (cur === c.label ? "" : c.label))
                            }
                            title={
                                c.restaurant_count > 0
                                    ? `${c.restaurant_count}`
                                    : undefined
                            }
                        >
                            {categoryLabel(c.name, i18n.language)}
                        </button>
                    ))}
                </div>
                {cats.isError && (
                    <p className="tb-sub mt-2" role="note">
                        {t("common.error")}:{" "}
                        {(cats.error as Error).message}
                    </p>
                )}
                <h2 className="tb-h2 mt-4">
                    <span>{t("nav.home")}</span>
                    <Link
                        to="/location"
                        className="text-sm font-bold underline"
                        style={{ color: "var(--tb-brand)" }}
                    >
                        {hasPoint ? t("home.change") : t("home.setLocation")}
                    </Link>
                </h2>
                {pointLabel ? (
                    <p className="tb-sub mt-1" role="status">
                        {t("home.deliveringTo", { label: pointLabel })}
                    </p>
                ) : (
                    <p className="tb-sub mt-1" role="status">
                        {t("home.noLocationSet")}
                    </p>
                )}
                {q.isLoading && (
                    <div className="flex flex-col gap-3 mt-3">
                        <Skeleton height={210} />
                        <Skeleton height={210} />
                    </div>
                )}
                {q.isError && (
                    <div className="mt-3 flex flex-col gap-2">
                        <Note tone="error">
                            {t("common.error")}: {(q.error as Error).message}
                        </Note>
                        <Button
                            variant="soft"
                            size="sm"
                            onClick={() => void q.refetch()}
                        >
                            Retry
                        </Button>
                    </div>
                )}
                {!q.isLoading && !q.isError && shops.length === 0 && (
                    <p className="tb-sub mt-3" role="status">
                        {t("home.noMatch")}
                    </p>
                )}
                <List className="tb-grid-shops mt-3">
                    {shops.map((r, i) => (
                        <Item key={r.id} index={i}>
                            <Link
                                to={`/restaurant/${r.id}`}
                                className="tb-shop"
                            >
                                <span className="tb-shop-img block">
                                    <img
                                        src={bannerImage(r.currency)}
                                        alt=""
                                        loading="lazy"
                                    />
                                    <AvailabilityBadge
                                        availability={r.availability}
                                        live_couriers_count={r.live_couriers_count}
                                        live_modes={r.live_modes}
                                        live_nearest_m={r.live_nearest_m}
                                        variant="float"
                                    />
                                    <span className="tb-float tb-float-rate">
                                        <RestaurantRating
                                            avg={r.rating_avg}
                                            count={r.rating_count}
                                        />
                                    </span>
                                    <span className="tb-float tb-float-dist">
                                        {formatDistance(
                                            r.distance_m,
                                            i18n.language,
                                        )}
                                    </span>
                                </span>
                                <span className="tb-shop-body block">
                                    <span className="tb-shop-name block">
                                        {r.name}
                                    </span>
                                    <span className="tb-shop-meta">
                                        {r.address} · ~{r.prep_minutes} min prep
                                    </span>
                                </span>
                            </Link>
                        </Item>
                    ))}
                </List>
                <ImpactQuote />
                {cartCount > 0 && (
                    <Link
                        to="/cart"
                        className="tb-cartbar"
                        aria-label={t("nav.cart")}
                    >
                        <span>
                            <strong className="block">
                                {formatMoney(cartTotal, cartCur, i18n.language)}
                            </strong>
                            <span>
                                {cartCount} items · {t("menu.cartTotal")}
                            </span>
                        </span>
                        <span className="tb-go">{t("nav.cart")} →</span>
                    </Link>
                )}
            </Page>
        </Shell>
    );
}

function RestaurantPage() {
    const { t } = useTranslation();
    const { id } = useParams();
    const [showOriginal, setShowOriginal] = useState(false);
    // Empty string = "All categories". Otherwise a menu category id; the
    // item list is narrowed server-side (`?category_id=`).
    const [menuCat, setMenuCat] = useState("");
    const add = useCart((s) => s.add);
    const setQty = useCart((s) => s.setQty);
    const cart = useCart((s) => s.items);
    const [added, setAdded] = useState<string | null>(null);
    const delivery = useDeliveryLocation();
    const { lat, lng } = delivery.loc;
    const info = useRestaurant({ id, lat, lng });
    const q = useMenu({ restaurantId: id, categoryId: menuCat });
    const lang = showOriginal ? "en" : i18n.language;
    const qtyOf = (dishId: string) =>
        cart.find((i) => i.id === dishId)?.qty ?? 0;
    function onAdd(item: { id: string; name: Record<string, string>; price: { amount_minor: number; currency: string } }) {
        if (!id) return;
        add(
            {
                id: item.id,
                name: item.name.en ?? "Item",
                priceMinor: item.price.amount_minor,
                currency: item.price.currency,
            },
            { id },
        );
        setAdded(item.id);
        setTimeout(
            () => setAdded((cur) => (cur === item.id ? null : cur)),
            800,
        );
    }
    return (
        <Shell>
            <Page>
                <div className="tb-promo" style={{ minHeight: 150 }}>
                    <img
                        src={bannerImage(info.data?.currency ?? "IDR")}
                        alt=""
                    />
                    <div className="tb-promo-body">
                        <Link
                            to="/"
                            className="tb-promo-kicker"
                            style={{ textDecoration: "none" }}
                        >
                            ← {t("nav.home")}
                        </Link>
                        <p className="tb-promo-title">
                            {info.data?.name ?? "…"}
                        </p>
                        <p className="tb-promo-sub">
                            {info.data?.address ?? ""}
                        </p>
                        {info.data && (
                            <p className="tb-dish-tags">
                                <Tag>
                                    <RestaurantRating
                                        avg={info.data.rating_avg}
                                        count={info.data.rating_count}
                                    />
                                </Tag>
                                {typeof info.data.distance_m ===
                                    "number" && (
                                    <Tag tone="dim">
                                        {formatDistance(
                                            info.data.distance_m,
                                            i18n.language,
                                        )}
                                    </Tag>
                                )}
                                <AvailabilityBadge
                                    availability={info.data.availability}
                                    live_couriers_count={info.data.live_couriers_count}
                                    live_modes={info.data.live_modes}
                                    live_nearest_m={info.data.live_nearest_m}
                                    variant="tag"
                                />
                                <Tag tone="dim">
                                    ~{info.data.prep_minutes} min prep
                                </Tag>
                            </p>
                        )}
                    </div>
                </div>
                <label className="text-sm flex gap-2 items-center font-semibold mt-3">
                    <input
                        type="checkbox"
                        checked={showOriginal}
                        onChange={(e) => setShowOriginal(e.target.checked)}
                    />{" "}
                    {t("menu.showOriginal")}
                </label>
                {(q.data?.categories ?? []).length > 0 && (
                    <div
                        className="tb-chips mt-3"
                        role="tablist"
                        aria-label={t("menu.categories")}
                    >
                        <button
                            role="tab"
                            aria-selected={menuCat === ""}
                            className={`tb-chip${menuCat === "" ? " on" : ""}`}
                            onClick={() => setMenuCat("")}
                        >
                            {t("menu.all")}
                        </button>
                        {(q.data?.categories ?? []).map((c) => (
                            <button
                                key={c.id}
                                role="tab"
                                aria-selected={menuCat === c.id}
                                className={`tb-chip${menuCat === c.id ? " on" : ""}`}
                                onClick={() =>
                                    setMenuCat((cur) => (cur === c.id ? "" : c.id))
                                }
                            >
                                {categoryLabel(c.name, i18n.language)}
                            </button>
                        ))}
                    </div>
                )}
                {q.isLoading && (
                    <div className="flex flex-col gap-2 mt-3">
                        <Skeleton height={110} />
                        <Skeleton height={110} />
                        <Skeleton height={110} />
                    </div>
                )}
                {q.isError && (
                    <div className="mt-3 flex flex-col gap-2">
                        <Note tone="error">
                            {t("common.error")}: {(q.error as Error).message}
                        </Note>
                        <Button
                            variant="soft"
                            size="sm"
                            onClick={() => void q.refetch()}
                        >
                            {t("common.retry")}
                        </Button>
                    </div>
                )}
                {q.data && q.data.items.length === 0 && (
                    <p className="tb-sub mt-3">{t("menu.empty")}</p>
                )}
                <List className="tb-dish-wrap flex flex-col gap-2 mt-3">
                    {(q.data?.items ?? []).map((item, i) => (
                        <Item key={item.id} index={i}>
                            <article className="tb-dish">
                                <img
                                    className="tb-dish-img"
                                    src={dishImage(item.name.en ?? "")}
                                    alt=""
                                    loading="lazy"
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="tb-dish-name">
                                        {item.name[lang] ?? item.name.en}
                                    </p>
                                    <p className="tb-dish-tags">
                                        {item.travels_well ? (
                                            <Tag>{t("menu.travelsWell")}</Tag>
                                        ) : (
                                            <Tag tone="warn">
                                                {t("menu.pickupOnly")}
                                            </Tag>
                                        )}
                                        <Tag tone="dim">
                                            {item.size_class}
                                        </Tag>
                                    </p>
                                    <p className="tb-dish-foot">
                                        <span className="tb-price">
                                            {formatMoney(
                                                item.price.amount_minor,
                                                item.price.currency,
                                                i18n.language,
                                            )}
                                        </span>
                                        {qtyOf(item.id) === 0 ? (
                                            <Button
                                                size="sm"
                                                variant="ember"
                                                disabled={!item.available}
                                                onClick={() => onAdd(item)}
                                            >
                                                {added === item.id
                                                    ? "Added ✓"
                                                    : `+ ${t("menu.add")}`}
                                            </Button>
                                        ) : (
                                            <span className="tb-step">
                                                <button
                                                    aria-label="decrease"
                                                    onClick={() =>
                                                        setQty({
                                                            id: item.id,
                                                            qty:
                                                                qtyOf(item.id) -
                                                                1,
                                                        })
                                                    }
                                                >
                                                    −
                                                </button>
                                                <strong key={qtyOf(item.id)}>
                                                    {qtyOf(item.id)}
                                                </strong>
                                                <button
                                                    aria-label="increase"
                                                    onClick={() => onAdd(item)}
                                                >
                                                    +
                                                </button>
                                            </span>
                                        )}
                                    </p>
                                </div>
                            </article>
                        </Item>
                    ))}
                </List>
            </Page>
        </Shell>
    );
}

function LocationPage() {
    return (
        <Shell>
            <AddressesPage />
        </Shell>
    );
}

function CartPage() {
    const { t } = useTranslation();
    const items = useCart((s) => s.items);
    const setQty = useCart((s) => s.setQty);
    const clear = useCart((s) => s.clear);
    const total = items.reduce((n, i) => n + i.priceMinor * i.qty, 0);
    const cur = items[0]?.currency ?? "IDR";
    return (
        <Shell>
            <Page>
                <h1 className="tb-display">{t("cart.title")}</h1>
                {items.length === 0 && (
                    <div className="tb-promo mt-3" style={{ minHeight: 220 }}>
                        <img src={img("dish-salad.jpg")} alt="" />
                        <div className="tb-promo-body">
                            <p className="tb-promo-title">{t("cart.empty")}</p>
                            <p className="mt-2">
                                <Link
                                    to="/"
                                    className="tb-btn tb-btn-ember tb-btn-sm"
                                    style={{ textDecoration: "none" }}
                                >
                                    {t("nav.home")}
                                </Link>
                            </p>
                        </div>
                    </div>
                )}
                <List className="flex flex-col gap-2 mt-3">
                    {items.map((i, idx) => (
                        <Item key={i.id} index={idx}>
                            <div className="tb-line-row">
                                <img src={dishImage(i.name)} alt="" />
                                <span className="flex-1 min-w-0">
                                    <strong className="block truncate">
                                        {i.name}
                                    </strong>
                                    <span className="tb-price">
                                        {formatMoney(
                                            i.priceMinor * i.qty,
                                            i.currency,
                                            i18n.language,
                                        )}
                                    </span>
                                </span>
                                <span className="tb-step">
                                    <button
                                        aria-label="decrease"
                                        onClick={() =>
                                            setQty({ id: i.id, qty: i.qty - 1 })
                                        }
                                    >
                                        −
                                    </button>
                                    <strong key={i.qty}>{i.qty}</strong>
                                    <button
                                        aria-label="increase"
                                        onClick={() =>
                                            setQty({ id: i.id, qty: i.qty + 1 })
                                        }
                                    >
                                        +
                                    </button>
                                </span>
                            </div>
                        </Item>
                    ))}
                </List>
                {items.length > 0 && (
                    <>
                        <div className="tb-total mt-3">
                            <p className="flex justify-between items-end">
                                <span className="font-bold">
                                    {t("menu.cartTotal")}
                                </span>
                                <span className="tb-grand">
                                    {formatMoney(total, cur, i18n.language)}
                                </span>
                            </p>
                            <p className="tb-promise mt-2">
                                {t("checkout.promise")}
                            </p>
                        </div>
                        <div className="mt-3 flex flex-col gap-2">
                            <Link
                                to="/checkout"
                                className="tb-btn tb-btn-ember tb-btn-block"
                            >
                                {t("cart.checkout")}
                            </Link>
                            <Button variant="soft" block onClick={clear}>
                                {t("cart.clear")}
                            </Button>
                        </div>
                    </>
                )}
            </Page>
        </Shell>
    );
}

function ProfilePage() {
    const { t } = useTranslation();
    const [msg, setMsg] = useState("");
    const [rt, setRt] = useState(false);
    const [topup, setTopup] = useState("50000");
    const [topupBusy, setTopupBusy] = useState(false);
    const user = savedUser();
    const wallet = useQuery({
        queryKey: ["wallet"],
        queryFn: getWallet,
        enabled: user !== null,
    });
    // Conversion preview: when the wallet currency is not directly
    // chargeable (e.g. IDR), Paddle charges USD and the wallet is credited
    // the full amount. The server computes the converted minor units.
    const walletCurrency = (wallet.data ?? [])[0]?.currency ?? "IDR";
    const topupAmount = Number.parseInt(topup, 10);
    const fxPreview = useQuery({
        queryKey: ["fx-preview", walletCurrency, topup],
        queryFn: () =>
            getFxPreview({ from: walletCurrency, to: "USD", amountMinor: topupAmount }),
        enabled:
            user !== null && Number.isFinite(topupAmount) && topupAmount > 0,
    });
    useEffect(() => {
        if (user)
            void wsTicket()
                .then((ticket) => {
                    const proto = location.protocol === "https:" ? "wss" : "ws";
                    const ws = new WebSocket(
                        `${proto}://${location.host}/api/v1/ws?ticket=${ticket}`,
                    );
                    ws.onopen = () => ws.send(JSON.stringify({ type: "ping" }));
                    ws.onmessage = () => setRt(true);
                    return () => ws.close();
                })
                .catch(() => undefined);
    }, []);
    async function topUp() {
        const amount = Number.parseInt(topup, 10);
        if (!Number.isFinite(amount) || amount <= 0) {
            setMsg(t("common.error"));
            return;
        }
        setTopupBusy(true);
        try {
            // Top up in the wallet's currency when known (multi-currency
            // wallets), else IDR. Minor units, never floats.
            const currency = (wallet.data ?? [])[0]?.currency ?? "IDR";
            const result = await topUpWithPaddle({
                amountMinor: amount,
                currency,
                email: user?.email,
            });
            if (result.kind === "topup_credited") {
                setMsg(t("topup.credited"));
            } else {
                // Overlay closed but the Paddle webhook has not credited yet:
                // the balance lands on confirm; refetch shows it when it does.
                setMsg(t("topup.pending"));
            }
            void wallet.refetch();
        } catch (e) {
            setMsg(e instanceof PayError ? e.message : t("common.error"));
        } finally {
            setTopupBusy(false);
        }
    }
    async function enablePush() {
        try {
            const perm = await Notification.requestPermission();
            if (perm !== "granted") {
                setMsg("Notification permission not granted.");
                return;
            }
            const reg = await navigator.serviceWorker.ready;
            const keyRes = await api<{ public_key: string }>(
                "/push/vapid-public-key",
            );
            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlB64(keyRes.public_key),
            });
            await api("/push/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    app: "customer",
                    subscription: sub.toJSON(),
                }),
            });
            setMsg("Push subscribed.");
        } catch (e) {
            setMsg(e instanceof Error ? e.message : t("common.error"));
        }
    }
    return (
        <Shell>
            <Page>
                <div
                    className="tb-total"
                    style={{ background: "var(--tb-brand-deep)" }}
                >
                    <p className="flex items-center gap-3">
                        <span
                            className="tb-avatar"
                            style={{
                                width: 52,
                                height: 52,
                                fontSize: "1.3rem",
                                background: "#fff",
                                color: "var(--tb-brand-deep)",
                            }}
                        >
                            {user ? user.email.slice(0, 1).toUpperCase() : "?"}
                        </span>
                        <span>
                            <strong className="block text-lg">
                                {user?.email ?? "Guest"}
                            </strong>
                            <span className="text-sm" style={{ opacity: 0.8 }}>
                                {user
                                    ? user.roles.join(", ")
                                    : "Log in for push and saved addresses."}{" "}
                                {rt && "· Live ✓"}
                            </span>
                        </span>
                    </p>
                </div>
                {msg && (
                    <div className="mt-3">
                        <Note tone="info">{msg}</Note>
                    </div>
                )}
                <div className="tb-total mt-3">
                    <p className="font-bold">{t("topup.title")}</p>
                    {(wallet.data ?? []).map((w) => (
                        <p className="tb-row" key={w.currency}>
                            <span>{t("topup.balance")}</span>
                            <span>
                                {formatMoney(
                                    w.balanceMinor,
                                    w.currency,
                                    i18n.language,
                                )}
                            </span>
                        </p>
                    ))}
                    <form
                        className="flex gap-2 mt-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void topUp();
                        }}
                    >
                        <Field label={t("topup.amount")}>
                            <input
                                className="tb-input"
                                inputMode="numeric"
                                autoComplete="off"
                                min={1}
                                value={topup}
                                onChange={(e) => setTopup(e.target.value)}
                                placeholder={t("topup.amountPh", { defaultValue: "e.g. 50000" })}
                                aria-label={t("topup.amount")}
                                disabled={topupBusy}
                            />
                        </Field>
                    </form>
                    <p className="tb-sub mt-1">
                        {t("topup.amount")} · {((wallet.data ?? [])[0]?.currency ?? "IDR")}
                    </p>
                    {fxPreview.data && (
                        <p className="tb-sub mt-1" role="note">
                            {t("topup.fxNotice", {
                                charge: formatMoney(
                                    fxPreview.data.convertedMinor,
                                    fxPreview.data.convertedCurrency,
                                    i18n.language,
                                ),
                                credit: formatMoney(
                                    topupAmount,
                                    walletCurrency,
                                    i18n.language,
                                ),
                            })}
                        </p>
                    )}
                    <div className="mt-2">
                        <Button
                            variant="ink"
                            block
                            disabled={topupBusy}
                            onClick={() => void topUp()}
                        >
                            {topupBusy ? "…" : t("topup.go")}
                        </Button>
                    </div>
                </div>
                <div className="flex flex-col gap-2 mt-3">
                    <Link
                        to="/orders"
                        className="tb-btn tb-btn-ink tb-btn-block"
                    >
                        {t("track.ordersTitle")}
                    </Link>
                    <Link
                        to="/impact"
                        className="tb-btn tb-btn-soft tb-btn-block"
                    >
                        {t("impact.mine")}
                    </Link>
                    <Button
                        variant="ember"
                        block
                        onClick={() => void enablePush()}
                    >
                        {t("profile.push")}
                    </Button>
                    <Button
                        variant="soft"
                        block
                        onClick={() =>
                            void api("/push/test", { method: "POST" }).then(
                                () => setMsg("Test push queued."),
                            )
                        }
                    >
                        {t("profile.pushTest")}
                    </Button>
                </div>
                <p className="tb-sub mt-3">{t("profile.iphoneGuide")}</p>
                <div className="mt-3">
                    <Button
                        variant="danger"
                        block
                        onClick={() => {
                            void logout().finally(() => {
                                setSession(null);
                                location.href = "/customer/login";
                            });
                        }}
                    >
                        {t("auth.logout")}
                    </Button>
                </div>
            </Page>
        </Shell>
    );
}

function urlB64(base64: string): Uint8Array<ArrayBuffer> {
    const pad = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

export default function App() {
    return (
        <Routes>
            <Route
                path="/"
                element={
                    <RequireAuth>
                        <Home />
                    </RequireAuth>
                }
            />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route
                path="/restaurant/:id"
                element={
                    <RequireAuth>
                        <RestaurantPage />
                    </RequireAuth>
                }
            />
            <Route
                path="/location"
                element={
                    <RequireAuth>
                        <LocationPage />
                    </RequireAuth>
                }
            />
            <Route
                path="/cart"
                element={
                    <RequireAuth>
                        <CartPage />
                    </RequireAuth>
                }
            />
            <Route
                path="/checkout"
                element={
                    <RequireAuth>
                        <Shell>
                            <CheckoutPage />
                        </Shell>
                    </RequireAuth>
                }
            />
            <Route
                path="/order/:id"
                element={
                    <RequireAuth>
                        <Shell>
                            <OrderPage />
                        </Shell>
                    </RequireAuth>
                }
            />
            <Route
                path="/orders"
                element={
                    <RequireAuth>
                        <Shell>
                            <OrdersPage />
                        </Shell>
                    </RequireAuth>
                }
            />
            <Route
                path="/impact"
                element={
                    <RequireAuth>
                        <Shell>
                            <ImpactPage />
                        </Shell>
                    </RequireAuth>
                }
            />
            <Route
                path="/profile"
                element={
                    <RequireAuth>
                        <ProfilePage />
                    </RequireAuth>
                }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
