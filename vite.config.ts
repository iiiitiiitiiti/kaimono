/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/kaimono/",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      // マニフェストは置かない。iPhone は manifest の start_url で起動すると URL の鍵（#k=…）が落ちるため、
      // ホーム画面へは「開いているページの URL」をそのまま置かせる（見た目は index.html の apple-* で指定）
      manifest: false,
      workbox: {
        navigateFallback: "index.html",
        // 文字（Noto Sans JP の分割ファイル）は全部で 6MB あるので最初には取り込まず、使った分だけ取っておく
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith(".woff2"),
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 200 } },
          },
        ],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    execArgv: ["--no-experimental-webstorage"],
  },
});
