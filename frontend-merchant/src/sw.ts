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
    new NetworkFirst({ cacheName: "tb-merchant-v1" }),
);
registerRoute(
    ({ request }) => request.destination === "image",
    new CacheFirst({ cacheName: "tb-merchant-img-v1" }),
);
self.addEventListener("push", (event) => {
    const data = (event.data?.json() ?? {}) as {
        title?: string;
        body?: string;
    };
    event.waitUntil(
        self.registration.showNotification(data.title ?? "Trackfud", {
            body: data.body ?? "",
        }),
    );
});
