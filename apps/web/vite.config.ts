import { defineConfig } from "vitest/config";
import { swPlugin } from "./vite/sw-plugin.mjs";

export default defineConfig({
  plugins: [swPlugin()],
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1100 },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
});
