import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { parseFeatures } from "./src/features-parse";
import { mockLivePlugin } from "./vite/mock-live-plugin.mjs";
import { swPlugin } from "./vite/sw-plugin.mjs";

export default defineConfig(({ mode, command }) => {
  // Stream simulado: solo en `vite` (serve) y con PULSO_MOCK_LIVE=1. Nunca en build.
  const env = loadEnv(mode, ".", "PULSO_");
  const mock = command === "serve" && env.PULSO_MOCK_LIVE === "1";
  // Flags de funciones como constantes de compilación (ver src/features.ts): lo apagado se elimina.
  const feats = parseFeatures(
    loadEnv(mode, ".", "VITE_").VITE_FEATURES ?? process.env.VITE_FEATURES,
  );
  return {
    define: {
      __FEATURE_LISTEN__: JSON.stringify(feats.listen),
      __FEATURE_REPLAY__: JSON.stringify(feats.replay),
      __FEATURE_PULSE__: JSON.stringify(feats.pulse),
      __FEATURE_CLIP__: JSON.stringify(feats.clip),
      __FEATURE_SHARE__: JSON.stringify(feats.share),
    },
    plugins: [
      swPlugin(),
      mockLivePlugin({ enabled: mock, buses: Number(env.PULSO_MOCK_BUSES) || 60 }),
    ],
    build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1100 },
    test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
  };
});
