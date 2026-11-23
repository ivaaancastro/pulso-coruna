import type { AddressInfo } from "node:net";
import type { Pulse } from "@pulso/schema";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig, type ApiConfig } from "../src/config.js";
import { emptyAggregates } from "../src/pulse.js";
import type { PulseQuery } from "../src/pulse-db.js";
import {
  SHARE_MAX_AGE_MS,
  escapeHtml,
  latestSharePoint,
  parseShareBaseUrl,
  parseShareLang,
  renderSharePage,
  shareText,
} from "../src/share.js";
import { FakeSource, testConfig } from "./helpers.js";

const MIN = 60_000;
const BASE = "https://pulso.example";
/** Martes 2025-11-18 14:41 Europe/Madrid (UTC+1) = 13:41 UTC. */
const TS = Date.UTC(2025, 10, 18, 13, 41, 0);

const pulse = (over: Partial<Pulse["points"][number]>[], profile: Pulse["profile"] = "fixed") =>
  ({
    v: 1,
    from: 0,
    to: 1,
    stepMs: 300_000,
    profile,
    points: over.map((p) => ({ ts: TS, value: 50, layers: {}, ...p })),
  }) as Pulse;

describe("parseShareBaseUrl", () => {
  it("sin valor = desactivado; normaliza barra final", () => {
    expect(parseShareBaseUrl(undefined)).toBeNull();
    expect(parseShareBaseUrl("  ")).toBeNull();
    expect(parseShareBaseUrl("https://pulso.example/")).toBe("https://pulso.example");
    expect(parseShareBaseUrl("http://localhost:5173")).toBe("http://localhost:5173");
    expect(parseShareBaseUrl("https://x.example/web/")).toBe("https://x.example/web");
  });
  it("rechaza lo que no es http(s), lleva credenciales, query o hash", () => {
    for (const bad of [
      "pulso.example",
      "javascript:alert(1)",
      "ftp://x.example",
      "https://u:p@x.example",
      "https://x.example/?a=1",
      "https://x.example/#a",
    ]) {
      expect(() => parseShareBaseUrl(bad), bad).toThrow(/SHARE_BASE_URL/);
    }
  });
  it("loadConfig la lee", () => {
    const env = { DATABASE_URL: "postgres://x@h/x", SHARE_BASE_URL: BASE };
    expect(loadConfig(env).shareBaseUrl).toBe(BASE);
    expect(loadConfig({ DATABASE_URL: env.DATABASE_URL }).shareBaseUrl).toBeNull();
  });
});

describe("escapeHtml y parseShareLang", () => {
  it("escapa los cinco caracteres peligrosos", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;",
    );
  });
  it("lang fuera de la lista → es", () => {
    expect(parseShareLang("gl")).toBe("gl");
    expect(parseShareLang("en")).toBe("en");
    for (const v of ["fr", '"><script>', undefined, ["gl"], 5])
      expect(parseShareLang(v)).toBe("es");
  });
});

describe("latestSharePoint y shareText", () => {
  it("toma el último punto si es reciente", () => {
    const p = pulse([{ ts: TS - 5 * MIN, value: 10 }, { value: 62.4 }]);
    expect(latestSharePoint(p, TS + MIN)).toEqual({ value: 62.4, ts: TS, profile: "fixed" });
  });
  it("sin puntos, antiguo o fuera de rango → null", () => {
    expect(latestSharePoint(pulse([]), TS)).toBeNull();
    expect(latestSharePoint(pulse([{}]), TS + SHARE_MAX_AGE_MS + 1)).toBeNull();
    expect(latestSharePoint(pulse([{ value: Number.NaN }]), TS)).toBeNull();
    expect(latestSharePoint(pulse([{ value: 130 }]), TS)).toBeNull();
    expect(latestSharePoint(pulse([{ value: -1 }]), TS)).toBeNull();
  });
  it("texto con datos en los tres idiomas (hora de Madrid, perfil fijo) y neutro sin ellos", () => {
    const point = { value: 61.6, ts: TS, profile: "fixed" as const };
    expect(shareText("es", point)).toMatchObject({ title: "Pulso A Coruña · 62/100" });
    expect(shareText("es", point).description).toMatch(
      /^Índice Pulso: 62 de 100 a las 14:41 \(hora de A Coruña\); perfil fijo: nivel sin calibrar\. A Coruña como/,
    );
    expect(shareText("gl", point).description).toContain("ás 14:41");
    expect(shareText("en", point).description).toContain("62 out of 100 at 14:41");
    const learned = shareText("es", { ...point, profile: "learned" });
    expect(learned.description).not.toContain("perfil fijo");
    const neutral = shareText("es", null);
    expect(neutral.title).toBe("Pulso A Coruña");
    expect(neutral.description).not.toMatch(/\d/);
  });
});

describe("renderSharePage", () => {
  const point = { value: 40, ts: TS, profile: "fixed" as const };
  it("lleva las metas OG/Twitter, imagen absoluta y redirección", () => {
    const html = renderSharePage({ baseUrl: BASE, lang: "es", point });
    expect(html).toContain('<meta property="og:title" content="Pulso A Coruña · 40/100" />');
    expect(html).toContain(`<meta property="og:image" content="${BASE}/og.png" />`);
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain(`<meta http-equiv="refresh" content="0;url=${BASE}/" />`);
    expect(html).toContain('<html lang="es">');
  });
  it("otros idiomas redirigen con ?lang=", () => {
    expect(renderSharePage({ baseUrl: BASE, lang: "gl", point })).toContain(
      `url=${BASE}/?lang=gl"`,
    );
  });
  it("escapa todo lo que se inserta (aunque la base lleve comillas o etiquetas)", () => {
    const evil = 'https://x.example/"><script>alert(1)</script>';
    const html = renderSharePage({ baseUrl: evil, lang: "es", point });
    expect(html).not.toContain("<script");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
  it("sin datos: texto neutro y ningún número", () => {
    const html = renderSharePage({ baseUrl: BASE, lang: "en", point: null });
    expect(html).toContain("<title>Pulso A Coruña</title>");
    expect(html).not.toMatch(/\/100|out of 100/);
  });
});

// ---------------------------------------------------------------------------------------------
// HTTP con fuente en memoria
// ---------------------------------------------------------------------------------------------

const open: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  for (const a of open.splice(0)) await a.close();
});

interface Started {
  src: FakeSource;
  base: string;
  get: (path?: string, headers?: HeadersInit) => Promise<Response>;
}

async function start(over: Partial<ApiConfig> = {}): Promise<Started> {
  const src = new FakeSource();
  const { app } = await buildApp(testConfig({ shareBaseUrl: BASE, ...over }), src);
  open.push(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return {
    src,
    base,
    get: (path = "", headers) => fetch(`${base}/api/v1/share${path}`, { headers }),
  };
}

/** Agregados con bus en movimiento en el tramo actual (la ventana depende de «ahora»). */
const withActivity = (src: FakeSource): void => {
  src.pulse = (q: PulseQuery) => {
    src.pulseCalls.push(q);
    const idx = Math.floor((Date.now() - q.from) / q.stepMs);
    return Promise.resolve({ ...emptyAggregates(), mobile: [{ layer: "bus", idx, moving: 20 }] });
  };
};

describe("GET /api/v1/share", () => {
  it("200 HTML con el índice real, ETag y Cache-Control corto", async () => {
    const { src, get } = await start();
    withActivity(src);
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    expect(r.headers.get("cache-control")).toMatch(/^public, max-age=([1-9]|[1-5]\d|60)$/);
    expect(r.headers.get("etag")).toMatch(/^"[\w-]{22}"$/);
    expect(r.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const html = await r.text();
    expect(html).toMatch(/<meta property="og:title" content="Pulso A Coruña · \d+\/100" \/>/);
    expect(html).toMatch(/Índice Pulso: \d+ de 100 a las \d\d:\d\d/);
    expect(html).toContain(`${BASE}/og.png`);
    expect(src.pulseCalls[0]?.layers.length).toBeGreaterThan(0);
  });

  it("lang=gl y lang inválido (→ es, sin reflejar el valor)", async () => {
    const { src, get } = await start();
    withActivity(src);
    expect(await (await get("?lang=gl")).text()).toContain('<html lang="gl">');
    const evil = await (await get(`?lang=${encodeURIComponent('"><script>x</script>')}`)).text();
    expect(evil).toContain('<html lang="es">');
    expect(evil).not.toContain("<script");
  });

  it("sin datos → texto neutro", async () => {
    const { get } = await start();
    const html = await (await get()).text();
    expect(html).toContain("<title>Pulso A Coruña</title>");
    expect(html).not.toMatch(/ de 100/);
  });

  it("BD caída → página neutra 200 (no 503) con caché corta", async () => {
    const { src, get } = await start();
    src.failing = true;
    const r = await get();
    expect(r.status).toBe(200);
    const ttl = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") ?? "")?.[1]);
    expect(ttl).toBeLessThanOrEqual(10);
    expect(await r.text()).toContain("<title>Pulso A Coruña</title>");
  });

  it("If-None-Match → 304 sin cuerpo", async () => {
    const { src, get } = await start();
    withActivity(src);
    const etag = (await get()).headers.get("etag") ?? "";
    const r = await get("", { "If-None-Match": etag });
    expect(r.status).toBe(304);
    expect(await r.text()).toBe("");
    expect(r.headers.get("etag")).toBe(etag);
  });

  it("reutiliza el cálculo (una sola lectura de BD) entre peticiones e idiomas", async () => {
    const { src, get } = await start();
    withActivity(src);
    await Promise.all([get(), get("?lang=gl"), get("?lang=en")]);
    await get();
    expect(src.pulseCalls).toHaveLength(1);
  });

  it("404 sin SHARE_BASE_URL", async () => {
    const { src, get } = await start({ shareBaseUrl: null });
    const r = await get();
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(src.pulseCalls).toHaveLength(0);
  });

  it("429 si el límite global de lecturas está ocupado; se libera al terminar", async () => {
    const { src, base, get } = await start({ pulseMaxPerIp: 5, pulseMaxGlobal: 1 });
    let release: () => void = () => undefined;
    const real = src.pulse.bind(src);
    src.pulse = async (q) => {
      await new Promise<void>((r) => (release = r));
      return real(q);
    };
    const now = Date.now();
    const busy = fetch(`${base}/api/v1/pulse?from=${now - 3_600_000}&to=${now}`);
    await new Promise((r) => setTimeout(r, 50));
    const r = await get();
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("2");
    expect(r.headers.get("cache-control")).toBe("no-store");
    release();
    expect((await busy).status).toBe(200);
    src.pulse = real;
    expect((await get()).status).toBe(200);
  });
});
