import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { mockLivePlugin } from "./vite/mock-live-plugin.mjs";
import { swPlugin } from "./vite/sw-plugin.mjs";

export default defineConfig(({ mode, command }) => {
  // Stream simulado: solo en `vite` (serve) y con PULSO_MOCK_LIVE=1. Nunca en build.
  const env = loadEnv(mode, ".", "PULSO_");
  const mock = command === "serve" && env.PULSO_MOCK_LIVE === "1";
  return {
    plugins: [
      swPlugin(),
      mockLivePlugin({ enabled: mock, buses: Number(env.PULSO_MOCK_BUSES) || 60 }),
    ],
    build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1100 },
    test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
  };
});
