import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ApiConfig } from "../src/config.js";
import { FakeSource, testConfig } from "./helpers.js";

const open: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  for (const a of open.splice(0)) await a.close();
});

async function start(over: Partial<ApiConfig>): Promise<string> {
  const { app } = await buildApp(
    testConfig({ shareBaseUrl: "https://pulso.example", ...over }),
    new FakeSource(),
  );
  open.push(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

const T = "?from=1760000000000&to=1760000300000";
const PATHS = {
  replay: `/api/v1/replay${T}`,
  pulse: `/api/v1/pulse${T}`,
  share: "/api/v1/share",
} as const;

describe("API_FEATURES: rutas de histórico", () => {
  it("sin flags responden 404 y el tiempo real sigue igual", async () => {
    const base = await start({ features: [] });
    for (const p of Object.values(PATHS)) expect((await fetch(base + p)).status).toBe(404);
    expect((await fetch(`${base}/api/v1/snapshot`)).status).toBe(200);
    const h = await fetch(`${base}/api/v1/health`);
    expect(h.status).toBe(200);
    expect(((await h.json()) as { v: number }).v).toBe(1);
  });

  it("cada flag monta solo su ruta", async () => {
    for (const f of ["replay", "pulse", "share"] as const) {
      const base = await start({ features: [f] });
      for (const [name, p] of Object.entries(PATHS)) {
        const status = (await fetch(base + p)).status;
        if (name === f) expect(status).not.toBe(404);
        else expect(status).toBe(404);
      }
    }
  });
});
