import { describe, expect, it, vi } from "vitest";
import type { StatusView } from "./credits";
import { startStatus } from "./start";
import { SOURCES } from "./sources";

const NOW = Date.parse("2026-11-20T10:00:00Z");
const STREAM = "ws://localhost:5173/api/v1/stream";
const report = (sources: unknown[], db = true) => ({
  v: 1,
  ts: NOW,
  status: "ok",
  db: { ok: db, latencyMs: 1 },
  sources,
  layers: {},
});

function setup(fetchHealth: (u: string, s: AbortSignal) => Promise<unknown>, streamUrl = STREAM) {
  const views: StatusView[] = [];
  const handle = startStatus({ panel: { update: (v) => views.push(v) }, streamUrl, fetchHealth });
  return { handle, views };
}

describe("estado por fuente (chunk diferido)", () => {
  it("pide /api/v1/health de nuestra API, pinta «cargando» y luego una fila por fuente", async () => {
    const fetchHealth = vi.fn(() =>
      Promise.resolve(
        report([
          { id: "bicicoruna", status: "ok", lastSuccessAt: NOW - 1000 },
          { id: "portus", status: "degraded", lastSuccessAt: NOW - 90_000 },
        ]),
      ),
    );
    const { handle, views } = setup(fetchHealth);
    await handle.refresh();
    expect(fetchHealth).toHaveBeenCalledWith(
      "http://localhost:5173/api/v1/health",
      expect.any(AbortSignal),
    );
    expect(views[0]).toEqual({ kind: "loading" });
    const ready = views[1];
    if (ready?.kind !== "ready") throw new Error("listo");
    expect(ready.rows).toHaveLength(SOURCES.length);
    expect(ready.ts).toBe(NOW);
    expect(ready.dbDown).toBe(false);
    const at = (key: string) => ready.rows[SOURCES.findIndex((s) => s.key === key)];
    expect(at("bicicoruna")).toEqual({ state: "live", lastSuccessAt: NOW - 1000 });
    expect(at("portus")?.state).toBe("delayed");
    expect(at("itranvias")?.state).toBe("inactive");
    expect(at("osm")?.state).toBe("static");
  });

  it("el 503 con cuerpo válido (BD caída) cuenta como informe", async () => {
    const { handle, views } = setup(() => Promise.resolve(report([], false)));
    await handle.refresh();
    expect(views[1]).toMatchObject({ kind: "ready", dbDown: true });
  });

  it("error de red o respuesta que no es un informe: error", async () => {
    const a = setup(() => Promise.reject(new Error("red")));
    await a.handle.refresh();
    expect(a.views[1]).toEqual({ kind: "error" });
    const b = setup(() => Promise.resolve({ hola: 1 }));
    await b.handle.refresh();
    expect(b.views[1]).toEqual({ kind: "error" });
  });

  it("URL de stream que no se puede derivar: sin API", async () => {
    const fetchHealth = vi.fn();
    const { handle, views } = setup(fetchHealth, "https://x/otra");
    await handle.refresh();
    expect(fetchHealth).not.toHaveBeenCalled();
    expect(views).toEqual([{ kind: "noapi" }]);
  });

  it("cancelar descarta la respuesta en vuelo; un refresco nuevo cancela el anterior", async () => {
    const signals: AbortSignal[] = [];
    let resolveFirst: (v: unknown) => void = () => undefined;
    const fetchHealth = vi
      .fn<(u: string, s: AbortSignal) => Promise<unknown>>()
      .mockImplementationOnce((_u, s) => {
        signals.push(s);
        return new Promise((r) => (resolveFirst = r));
      })
      .mockImplementation((_u, s) => {
        signals.push(s);
        return Promise.resolve(report([]));
      });
    const { handle, views } = setup(fetchHealth);
    const first = handle.refresh();
    const second = handle.refresh();
    expect(signals[0]?.aborted).toBe(true);
    resolveFirst(report([{ id: "bicicoruna", status: "down", lastSuccessAt: null }]));
    await Promise.all([first, second]);
    expect(views.filter((v) => v.kind === "ready")).toHaveLength(1);
    handle.cancel();
    expect(handle).toBeDefined();
  });
});
