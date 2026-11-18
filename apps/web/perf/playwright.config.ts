import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const PORT = 4173;

// Usa el Chrome estable instalado (runner ubuntu-latest y equipos de desarrollo): sin descargas de navegador.
// PERF_BROWSER_CHANNEL=chromium para el Chromium de Playwright (tras `playwright install chromium`).
const channel = process.env.PERF_BROWSER_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // los fps no se miden en paralelo
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: channel === "chromium" ? undefined : channel,
    viewport: { width: 390, height: 844 },
    launchOptions: {
      // WebGL por software: los runners no tienen GPU. En un equipo con GPU, PERF_FPS_PROFILE=gpu.
      args:
        process.env.PERF_FPS_PROFILE === "gpu"
          ? []
          : [
              "--use-gl=angle",
              "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader",
              "--ignore-gpu-blocklist",
            ],
    },
  },
  webServer: {
    // Sirve el build de producción (requiere `pnpm --filter @pulso/web build` previo).
    command: `pnpm --filter @pulso/web exec vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: root,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
