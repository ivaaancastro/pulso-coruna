import { defineConfig } from "vitest/config";

export default defineConfig({
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1100 },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
});
