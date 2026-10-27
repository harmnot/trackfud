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
    new NetworkFirst({ cacheName: "tb-courier-v2" }),
);
registerRoute(
    ({ request }) => request.destination === "image",
    new CacheFirst({ cacheName: "tb-courier-img-v2" }),
);

type PushData = { title?: string; body?: string; kind?: string; url?: string };

self.addEventListener("push", (event) => {
    const data = (event.data?.json() ?? {}) as PushData;
    const isOffer = data.kind === "offer";
    event.waitUntil(
        self.registration.showNotification(data.title ?? "Trackfud", {
            body: data.body ?? "",
            tag: isOffer ? "tb-offer" : "tb-note",
            requireInteraction: isOffer,
            data: { url: data.url ?? "/courier/run" },
        }),
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = ((event.notification.data as { url?: string } | undefined)
        ?.url ?? "/courier/run") as string;
    event.waitUntil(
        (async () => {
            const wins = await self.clients.matchAll({
                type: "window",
                includeUncontrolled: true,
            });
            for (const w of wins) {
                if ("focus" in w) {
                    await (w as WindowClient).focus();
                    return;
                }
            }
            await self.clients.openWindow(url);
        })(),
    );
});

// The app suppresses its own "update ready" prompt mid-run (see
// `isMidRun`): the worker still installs, it just never forces a reload.
self.addEventListener("message", (event) => {
    if ((event.data as { type?: string })?.type === "SKIP_WAITING")
        void self.skipWaiting();
});
