/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope & {
    __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};
precacheAndRoute(self.__WB_MANIFEST);
// Public catalog reads: network-first with cache fallback. Private API never cached.
registerRoute(
    ({ url }) => url.pathname.includes("/customer/restaurants"),
    new NetworkFirst({ cacheName: "tb-customer-catalog-v1" }),
);
registerRoute(
    ({ request }) => request.destination === "image",
    new CacheFirst({ cacheName: "tb-customer-images-v1" }),
);
type PushData = {
    title?: string;
    body?: string;
    orderId?: string;
    status?: string;
};
self.addEventListener("push", (event) => {
    const data = (event.data?.json() ?? {}) as PushData;
    const tag = data.orderId ? `order-${data.orderId}` : "Trackfud-general";
    const url = data.orderId
        ? `/customer/order/${data.orderId}`
        : "/customer/orders";
    event.waitUntil(
        self.registration.showNotification(data.title ?? "Trackfud", {
            body: data.body ?? "",
            tag,
            data: { url },
        }),
    );
});
self.addEventListener("notificationclick", (event) => {
    const url =
        (event.notification.data as { url?: string } | undefined)?.url ??
        "/customer/orders";
    event.notification.close();
    event.waitUntil(
        (async () => {
            const wins = await self.clients.matchAll({
                type: "window",
                includeUncontrolled: true,
            });
            for (const w of wins) {
                if (w.url.includes("/customer/") && "focus" in w) {
                    await w.focus();
                    if ("navigate" in w)
                        await (w as WindowClient).navigate(url);
                    return;
                }
            }
            await self.clients.openWindow(url);
        })(),
    );
});
