import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";

export default defineConfig({
    base: "/merchant/",
    plugins: [
        react(),
        tailwindcss(),
        VitePWA({
            strategies: "injectManifest",
            srcDir: "src",
            filename: "sw.ts",
            registerType: "prompt",
            manifest: {
                id: "/merchant/",
                name: "Trackfud",
                short_name: "Trackfud",
                description: "Health-first food delivery — Merchant",
                display: "standalone",
                start_url: "/merchant/",
                scope: "/merchant/",
                theme_color: "#0f7a4d",
                background_color: "#ffffff",
                icons: [
                    {
                        src: "icons/icon-192.png",
                        sizes: "192x192",
                        type: "image/png",
                    },
                    {
                        src: "icons/icon-512.png",
                        sizes: "512x512",
                        type: "image/png",
                    },
                    {
                        src: "icons/maskable-512.png",
                        sizes: "512x512",
                        type: "image/png",
                        purpose: "maskable",
                    },
                ],
            },
        }),
    ],
    server: {
        port: 5175,
        proxy: {
            "/api": {
                target: "http://localhost:8081",
                changeOrigin: true,
                rewrite: (p) => p.replace(/^\/api/, ""),
            },
        },
    },
});
