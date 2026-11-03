import { useTranslation } from "react-i18next";

/**
 * Server-driven restaurant rating. Renders `★ 4.6 (12)` from the
 * `rating_avg` / `rating_count` the catalog API aggregates over collected
 * `restaurant_stars` — and the `home.unrated` label while nobody has rated
 * yet. Never invents a number: an unrated restaurant shows New, not a
 * placeholder score.
 */
export function RestaurantRating({
    avg,
    count,
}: {
    avg?: number | null;
    count?: number;
}) {
    const { t } = useTranslation();
    if (
        typeof avg === "number" &&
        Number.isFinite(avg) &&
        typeof count === "number" &&
        count > 0
    ) {
        return (
            <>
                ★ {avg.toFixed(1)} ({count})
            </>
        );
    }
    return <>★ {t("home.unrated")}</>;
}
