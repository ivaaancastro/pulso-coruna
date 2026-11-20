/* global process, console, window, location, performance, requestAnimationFrame, fetch, URL */
// Puerta de M6: verificación de punta a punta del modo Reproducir contra la API REAL (TimescaleDB con datos
// sintéticos). No es parte de `pnpm perf` (necesita la pila levantada). Ver docs/specs/M6-puerta.md.
//
//   WEB=http://127.0.0.1:5190 API=http://127.0.0.1:3000 node apps/web/perf/puerta-m6.mjs [--shots]
//
// Requiere: BD sembrada (`pnpm --filter @pulso/ingest seed:synthetic`), API en marcha y la web (`vite`) con
// `VITE_LIVE_URL=ws://127.0.0.1:3000/api/v1/stream`. Usa `window.__pulsoReplay` (solo existe en `vite` dev).
import { chromium } from "@playwright/test";
import { decode } from "@msgpack/msgpack";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WEB = process.env.WEB ?? "http://127.0.0.1:5190";
const API = process.env.API ?? "http://127.0.0.1:3000";
const SHOTS = process.argv.includes("--shots");
const OUT = fileURLToPath(new URL("../../../docs/design/capturas/", import.meta.url));
const FLAGS =
  process.env.PERF_FPS_PROFILE === "gpu"
    ? []
    : [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
      ];
const MIN = 60_000;
const WIN = 300_000;
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};
const r1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

/** fps con rAF durante `ms`, en la página. */
const fpsIn = (page, ms) =>
  page.evaluate(async (durationMs) => {
    const d = [];
    await new Promise((resolve) => {
      let last = performance.now();
      const start = last;
      const tick = (now) => {
        d.push(now - last);
        last = now;
        if (now - start < durationMs) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    d.shift();
    const f = d.map((x) => 1000 / x).sort((a, b) => a - b);
    const sorted = [...d].sort((a, b) => a - b);
    return {
      frames: d.length,
      avg: f.reduce((a, b) => a + b, 0) / f.length,
      p5: f[Math.floor(f.length * 0.05)],
      p95ms: sorted[Math.floor(sorted.length * 0.95)],
      maxMs: sorted[sorted.length - 1],
    };
  }, ms);

const state = (page) => page.evaluate(() => window.__pulsoReplay?.getState());
const status = (page) => page.evaluate(() => ({ ...window.__pulsoReplay?.status }));

async function scenario(browser, name, viewport) {
  const ctx = await browser.newContext({ viewport, locale: "es-ES", timezoneId: "Europe/Madrid" });
  const page = await ctx.newPage();
  const log = { name, viewport, console: [], pageErrors: [], req: [], res: [], steps: {} };
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type()))
      log.console.push(`${m.type()}: ${m.text()}`.slice(0, 300));
  });
  page.on("pageerror", (e) => log.pageErrors.push(String(e).slice(0, 300)));
  const t0 = Date.now();
  const track = new Map();
  ctx.on("request", (rq) => {
    if (rq.url().includes("/api/v1/replay")) {
      track.set(rq, Date.now());
      const from = Number(new URL(rq.url()).searchParams.get("from"));
      log.req.push({ at: Date.now() - t0, from });
    }
  });
  ctx.on("requestfinished", async (rq) => {
    if (!rq.url().includes("/api/v1/replay")) return;
    const res = await rq.response();
    const body = await res?.body().catch(() => null);
    log.res.push({
      status: res?.status(),
      ms: Date.now() - (track.get(rq) ?? Date.now()),
      bytes: body?.length ?? 0,
      cache: res?.headers()["cache-control"],
      from: Number(new URL(rq.url()).searchParams.get("from")),
    });
  });
  ctx.on("requestfailed", (rq) => {
    if (rq.url().includes("/api/v1/replay"))
      log.res.push({ status: 0, failure: rq.failure()?.errorText, ms: 0, bytes: 0 });
  });
  const shot = async (tag) => {
    if (SHOTS) await page.screenshot({ path: `${OUT}puerta-m6-${name}-${tag}.png` });
  };

  await page.goto(`${WEB}/`);
  await page.waitForFunction(
    () => performance.getEntriesByName("map:first-frame").length > 0,
    null,
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () =>
      ["map:intro-end", "map:intro-interrupted", "map:intro-skipped"].some(
        (n) => performance.getEntriesByName(n).length,
      ),
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(2500);
  await shot("0-ahora");

  // 1) Entrar en Reproducir.
  await page.getByRole("radio", { name: "Reproducir" }).click();
  await page.waitForSelector(".timeline:not([hidden])");
  await page.waitForTimeout(2500);
  log.steps.enter = { state: await state(page), status: await status(page) };
  await shot("1-reproducir");

  // 2) Día: ayer (hay datos todo el día; hoy solo hasta «ahora»). Se lee el valor de la opción.
  const days = await page.$$eval(".timeline__select option", (o) => o.map((x) => x.value));
  await page.selectOption(".timeline__select", days[1]);
  await page.waitForTimeout(1500);
  log.steps.day = { state: await state(page), status: await status(page) };

  // Ayer a las 10:00 UTC (hay buses, barcos y aviones). El día elegido sigue siendo «ayer».
  const day1 = Number(days[1]);
  const t10 = day1 + 11 * 3_600_000; // 11:00 Madrid ≈ 10:00 UTC
  await page.evaluate((t) => window.__pulsoReplay.applyState({ t, playing: false }), t10);
  await page.waitForTimeout(2500);
  await shot("2-dia-ayer");

  // 3) 1× y 60×: el reloj avanza lo que toca.
  for (const [speed, label] of [
    [1, "1×"],
    [60, "60×"],
  ]) {
    await page
      .locator(".timeline__speed")
      .nth(speed === 1 ? 0 : 1)
      .click();
    if (!(await state(page)).playing) await page.locator(".timeline__play").click();
    const a = (await state(page)).t;
    await page.waitForTimeout(4000);
    const b = (await state(page)).t;
    log.steps[`speed${speed}`] = {
      advancedMs: b - a,
      expectedApproxMs: 4000 * speed,
      label,
      status: await status(page),
    };
    await page.evaluate(() => window.__pulsoReplay.applyState({ playing: false }));
  }

  // 4) 600× en frío: se cuenta cada petición nueva. Reproducción larga para que haya decenas de ventanas.
  const tCold = day1 + (name.startsWith("movil") ? 15 : 19) * 3_600_000; // ventanas no pedidas todavía
  await page.evaluate((t) => window.__pulsoReplay.applyState({ t, playing: false }), tCold);
  await page.locator(".timeline__speed").nth(2).click();
  await page.waitForTimeout(1500);
  const reqBefore = log.req.length;
  const resBefore = log.res.length;
  const tStart = Date.now();
  await page.locator(".timeline__play").click();
  const fps600 = await fpsIn(page, 8000);
  const stat600 = await status(page);
  const adv = (await state(page)).t - tCold;
  const secs = (Date.now() - tStart) / 1000;
  const reqs600 = log.req.slice(reqBefore);
  const perSec = {};
  for (const q of reqs600)
    perSec[Math.floor((q.at - reqs600[0].at) / 1000)] =
      (perSec[Math.floor((q.at - reqs600[0].at) / 1000)] ?? 0) + 1;
  log.steps.cold600 = {
    fps: fps600,
    simAdvancedMin: adv / MIN,
    realSeconds: secs,
    effectiveSpeed: adv / 1000 / secs,
    requests: reqs600.length,
    reqPerSecMax: Math.max(0, ...Object.values(perSec)),
    reqPerSecAvg: reqs600.length / secs,
    responses: log.res
      .slice(resBefore)
      .map((x) => x.status)
      .reduce((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {}),
    status: stat600,
  };
  await shot("3-600x");

  // 5) Scrub: arrastre continuo del cursor ida y vuelta sobre el día.
  await page.evaluate(() => window.__pulsoReplay.applyState({ playing: false, speed: 60 }));
  const box = await page.locator(".timeline__track").boundingBox();
  const y = box.y + box.height / 2;
  const reqS = log.req.length;
  await page.mouse.move(box.x + box.width * 0.1, y);
  await page.mouse.down();
  const scrubFps = page.evaluate(async () => {
    const d = [];
    await new Promise((resolve) => {
      let last = performance.now();
      const start = last;
      const tick = (now) => {
        d.push(now - last);
        last = now;
        if (now - start < 5000) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    d.shift();
    const f = d.map((x) => 1000 / x).sort((a, b) => a - b);
    const s = [...d].sort((a, b) => a - b);
    return {
      frames: d.length,
      avg: f.reduce((a, b) => a + b, 0) / f.length,
      p5: f[Math.floor(f.length * 0.05)],
      p95ms: s[Math.floor(s.length * 0.95)],
      maxMs: s[s.length - 1],
    };
  });
  for (let i = 0; i < 60; i++) {
    const f = 0.1 + 0.8 * (0.5 + 0.5 * Math.sin(i / 5));
    await page.mouse.move(box.x + box.width * f, y);
    await page.waitForTimeout(80);
  }
  await page.mouse.up();
  log.steps.scrub = {
    fps: await scrubFps,
    requests: log.req.length - reqS,
    state: await state(page),
    status: await status(page),
  };
  await page.waitForTimeout(2500);
  await shot("4-scrub");

  // 6) Enlace compartido: se abre en una página nueva con #v=1…; no debe pedir la ventana de hace 1 h.
  const link = new Date(t10).toISOString().slice(0, 16) + "Z";
  const p2 = await ctx.newPage();
  const seen = [];
  ctx.on("request", (rq) => {
    if (rq.url().includes("/api/v1/replay") && rq.frame()?.page() === p2)
      seen.push(Number(new URL(rq.url()).searchParams.get("from")));
  });
  p2.on("console", (m) => {
    if (["error", "warning"].includes(m.type()))
      log.console.push(`[link] ${m.type()}: ${m.text()}`.slice(0, 300));
  });
  await p2.setViewportSize(viewport);
  await p2.goto(`${WEB}/#v=1&c=43.3623,-8.4115,13.5,0,45&m=r&t=${link}&s=60`);
  await p2.waitForFunction(() => window.__pulsoReplay?.getState().mode === "replay", null, {
    timeout: 30_000,
  });
  await p2.waitForTimeout(3000);
  const st2 = await p2.evaluate(() => ({
    ...window.__pulsoReplay.getState(),
    status: { ...window.__pulsoReplay.status },
  }));
  log.steps.shareLink = {
    link,
    state: st2,
    windowsRequestedFrom: [...new Set(seen)].map((f) => new Date(f).toISOString()),
    hash: await p2.evaluate(() => location.hash),
  };
  if (SHOTS) await p2.screenshot({ path: `${OUT}puerta-m6-${name}-5-enlace.png` });

  // 7) Cruce del corte raw/1m (solo alcanzable con applyState: el selector de 30 días no llega). Se arranca
  // 6 min antes del corte a 600× y se anota la resolución que declara la barra cada 300 ms.
  const cutoff = Math.floor((Date.now() - 30 * 86_400_000) / MIN) * MIN;
  const tCut = cutoff - 6 * MIN;
  await p2.evaluate(
    (t) => window.__pulsoReplay.applyState({ t, speed: 600, playing: false }),
    tCut,
  );
  await p2.waitForTimeout(2500);
  const before = await p2.evaluate(() => ({ ...window.__pulsoReplay.status }));
  if (SHOTS) await p2.screenshot({ path: `${OUT}puerta-m6-${name}-6-corte-1m.png` });
  await p2.evaluate(() => window.__pulsoReplay.applyState({ playing: true }));
  const trace = [];
  for (let i = 0; i < 12; i++) {
    await p2.waitForTimeout(300);
    const x = await p2.evaluate(() => ({
      t: window.__pulsoReplay.getState().t,
      ...window.__pulsoReplay.status,
    }));
    trace.push(
      `${new Date(x.t).toISOString().slice(11, 19)} ${x.resolution}${x.loading ? " loading" : ""}${x.error ? ` ERR:${x.error}` : ""}${x.noData ? " nodata" : ""}`,
    );
  }
  log.steps.cutoff = {
    cutoff: new Date(cutoff).toISOString(),
    startedAt: new Date(tCut).toISOString(),
    before,
    statusText: await p2.locator(".timeline__status").textContent(),
    trace,
  };
  if (SHOTS) await p2.screenshot({ path: `${OUT}puerta-m6-${name}-6b-corte-cruzado.png` });
  await p2.evaluate(() => window.__pulsoReplay.applyState({ playing: false }));

  // 8) Volver a «Ahora»: la barra se oculta y la hora vuelve a ser la real.
  await p2.getByRole("radio", { name: "Ahora" }).click();
  await p2.waitForTimeout(2500);
  log.steps.backToNow = {
    mode: await p2.evaluate(() => window.__pulsoReplay.getState().mode),
    timelineHidden: await p2.locator(".timeline").evaluate((e) => e.hidden),
    clockText: await p2
      .locator(".clock")
      .first()
      .textContent()
      .catch(() => null),
    realUtc: new Date().toISOString(),
  };
  if (SHOTS) await p2.screenshot({ path: `${OUT}puerta-m6-${name}-7-ahora.png` });

  const ok = log.res.filter((x) => x.status === 200);
  log.summary = {
    requests: log.req.length,
    byStatus: log.res.reduce((m, x) => ({ ...m, [x.status]: (m[x.status] ?? 0) + 1 }), {}),
    windowBytesAvg: ok.length ? Math.round(ok.reduce((a, b) => a + b.bytes, 0) / ok.length) : null,
    windowBytesMax: ok.length ? Math.max(...ok.map((x) => x.bytes)) : null,
    latencyMs: {
      p50: pct(
        ok.map((x) => x.ms),
        50,
      ),
      p95: pct(
        ok.map((x) => x.ms),
        95,
      ),
      max: Math.max(0, ...ok.map((x) => x.ms)),
    },
  };
  await ctx.close();
  return log;
}

/** API directa: latencia en frío/caliente, tamaños, 304, concurrencia contra los límites. */
async function apiProbe() {
  const out = {};
  const url = (from, layers = "") =>
    `${API}/api/v1/replay?from=${from}&to=${from + WIN}${layers ? `&layers=${layers}` : ""}`;
  const timed = async (u, init) => {
    const t = performance.now();
    const r = await fetch(u, init);
    const b = new Uint8Array(await r.arrayBuffer());
    return {
      status: r.status,
      ms: performance.now() - t,
      bytes: b.length,
      headers: r.headers,
      body: b,
    };
  };
  // Cold secuencial (día con datos: hace 30 h … ), 20 ventanas.
  const start = Math.floor((Date.now() - 30 * 3_600_000) / WIN) * WIN;
  const cold = [];
  for (let i = 0; i < 20; i++) cold.push(await timed(url(start + i * WIN)));
  const warm = [];
  for (let i = 0; i < 20; i++) warm.push(await timed(url(start + i * WIN)));
  const c = cold.filter((x) => x.status === 200);
  const w = warm.filter((x) => x.status === 200);
  out.coldSequential = {
    n: cold.length,
    statuses: cold.map((x) => x.status).join(","),
    ms: {
      p50: r1(
        pct(
          c.map((x) => x.ms),
          50,
        ),
      ),
      p95: r1(
        pct(
          c.map((x) => x.ms),
          95,
        ),
      ),
    },
    bytesAvg: Math.round(c.reduce((a, b) => a + b.bytes, 0) / (c.length || 1)),
  };
  out.warm = {
    ms: {
      p50: r1(
        pct(
          w.map((x) => x.ms),
          50,
        ),
      ),
      p95: r1(
        pct(
          w.map((x) => x.ms),
          95,
        ),
      ),
    },
    cacheControl: warm[0]?.headers.get("cache-control"),
  };
  const first = cold[0];
  if (first?.status === 200) {
    const win = decode(first.body);
    out.sample = {
      resolution: win.resolution,
      layers: Object.fromEntries(
        Object.entries(win.layers).map(([k, v]) => [
          k,
          v.tracks?.length ?? v.stations?.length ?? v.series?.length ?? 0,
        ]),
      ),
    };
    const re = await timed(url(start), { headers: { "if-none-match": first.headers.get("etag") } });
    out.etag304 = re.status;
  }
  // Concurrencia en frío: 12 ventanas nuevas a la vez desde una IP.
  const s2 = start - 40 * WIN;
  const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => timed(url(s2 + i * WIN))));
  out.burst12 = burst.reduce((m, x) => ({ ...m, [x.status]: (m[x.status] ?? 0) + 1 }), {});
  out.burst12RetryAfter =
    burst.find((x) => x.status === 429 || x.status === 503)?.headers.get("retry-after") ?? null;
  return out;
}

/** Corte raw/1m directo en la API (se ejecuta al final: la caché «inmutable» fija la resolución de cada ventana). */
async function cutoffProbe() {
  const out = {};
  const url = (from) => `${API}/api/v1/replay?from=${from}&to=${from + WIN}`;
  const timed = async (u) => {
    const r = await fetch(u);
    const b = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, bytes: b.length, body: b };
  };
  // Corte raw/1m directo.
  const cutoff = Math.floor((Date.now() - 30 * 86_400_000) / MIN) * MIN;
  const f = Math.floor(cutoff / WIN) * WIN - WIN;
  const cut = [];
  for (const k of [0, 1, 2]) {
    const r = await timed(url(f + k * WIN));
    const win = r.status === 200 ? decode(r.body) : null;
    cut.push({
      from: new Date(f + k * WIN).toISOString(),
      status: r.status,
      resolution: win?.resolution,
      busTracks: win?.layers?.bus?.tracks?.length,
      busSamples: win?.layers?.bus?.tracks?.reduce((a, t) => a + t.ts.length, 0),
      bytes: r.bytes,
    });
  }
  out.cutoff = { cutoff: new Date(cutoff).toISOString(), windows: cut };
  return out.cutoff;
}

const channel = process.env.PERF_BROWSER_CHANNEL ?? "chrome"; // como perf/playwright.config.ts
const browser = await chromium.launch({
  args: FLAGS,
  ...(channel === "chromium" ? {} : { channel }),
});
if (SHOTS) mkdirSync(OUT, { recursive: true });
const result = { when: new Date().toISOString(), flags: FLAGS.length ? "swiftshader" : "gpu" };
if (!process.env.SKIP_API) result.api = await apiProbe();
const only = process.env.ONLY; // "movil" | "escritorio"
if (only !== "escritorio")
  result.mobile = await scenario(browser, "movil-390x844", { width: 390, height: 844 });
if (only !== "movil")
  result.desktop = await scenario(browser, "escritorio-1440x900", { width: 1440, height: 900 });
if (!process.env.SKIP_API) result.api.cutoffProbe = await cutoffProbe();
await browser.close();
const file = process.env.PUERTA_OUT;
if (file) writeFileSync(file, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
