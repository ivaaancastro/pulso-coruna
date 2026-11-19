import type { ReplayWindow } from "@pulso/schema";
import type { WorkerInput, WorkerOutput } from "../live/types";
import { ReplayEngine } from "./engine";
import type { LoadResult } from "./loader";
import { buildActive, type ActiveSet } from "./series";
import type { ReplayErrorKind, ReplayStatus } from "./types";
import { WINDOW_MS, WindowCache, windowStart } from "./windows";

export interface ReplayWorkerDeps {
  /** Envía al hilo principal; `transfer` lleva los ArrayBuffer que se ceden. */
  post: (message: WorkerOutput, transfer: ArrayBuffer[]) => void;
  /** Crea el cargador de ventanas para la URL base (`…/api/v1/replay`). */
  createLoader: (baseUrl: string) => {
    load(from: number, signal: AbortSignal): Promise<LoadResult>;
  };
  /** Reloj monotónico, ms (`performance.now`). */
  clock: () => number;
  /** Ventanas que se piden a la vez (la API admite 4 lecturas de BD por IP). */
  maxConcurrent?: number;
  /** Espera tras un salto grande (arrastre) antes de pedir ventanas nuevas, ms. */
  debounceMs?: number;
  /** Mínimo entre dos emisiones de cambios de elementos, ms. */
  itemsMinMs?: number;
  /** Espera antes de reintentar una ventana que falló, ms. */
  retryAfterMs?: number;
  /** Segundos de reproducción que se quieren tener ya descargados por delante. */
  prefetchSeconds?: number;
}

const MAX_AHEAD = 8;

/**
 * Lógica del worker de reproducción sin APIs globales (se prueba en Node). Habla el mismo
 * protocolo que el worker en vivo (`tick` → `frames`/`items`) y añade `reset` y `replay` (estado).
 *
 * Por cada `tick(now)` del hilo principal: decide qué ventanas hacen falta (la del instante, la
 * siguiente, y las que quedan por delante según la velocidad; al ir hacia atrás, también las
 * anteriores), las pide sin pasar de `maxConcurrent` y con un debounce tras los saltos, y calcula
 * el fotograma. Si la ventana del instante no ha llegado no calcula nada: las capas conservan lo
 * último que se vio y el hilo principal detiene el reloj (`loading`).
 */
export function createReplayWorkerCore(deps: ReplayWorkerDeps): (input: WorkerInput) => void {
  const maxConcurrent = deps.maxConcurrent ?? 3;
  const debounceMs = deps.debounceMs ?? 120;
  const itemsMinMs = deps.itemsMinMs ?? 250;
  const retryAfterMs = deps.retryAfterMs ?? 5000;
  const prefetchSeconds = deps.prefetchSeconds ?? 4;

  const engine = new ReplayEngine();
  const cache = new WindowCache<ReplayWindow>();
  const inflight = new Map<number, AbortController>();
  const failed = new Map<number, { at: number; reason: ReplayErrorKind }>();
  let loader: ReturnType<ReplayWorkerDeps["createLoader"]> | null = null;
  let reduced = false;

  let prevNow: number | null = null;
  let prevReal = 0;
  let prevW0: number | null = null;
  let lastMoveReal = 0;
  let rate = 0;
  let dir: 1 | -1 = 1;
  let debounceUntil = 0;
  let lastItemsAt = Number.NEGATIVE_INFINITY;
  let status: ReplayStatus | null = null;

  let activeW0: ReplayWindow | null = null;
  let activeW1: ReplayWindow | null = null;
  let activeSet: ActiveSet | null = null;

  const wantedFor = (w0: number): number[] => {
    const ahead = Math.min(
      MAX_AHEAD,
      Math.max(1, Math.ceil((rate * prefetchSeconds * 1000) / WINDOW_MS)),
    );
    const out = [w0, w0 + WINDOW_MS];
    if (rate < 0.5) {
      out.push(w0 - WINDOW_MS);
      return out;
    }
    if (dir > 0) {
      for (let k = 2; k <= ahead + 1; k++) out.push(w0 + k * WINDOW_MS);
      out.push(w0 - WINDOW_MS);
    } else {
      for (let k = 1; k <= ahead; k++) out.push(w0 - k * WINDOW_MS);
    }
    return out;
  };

  const start = (from: number): void => {
    if (!loader) return;
    const controller = new AbortController();
    inflight.set(from, controller);
    void loader
      .load(from, controller.signal)
      .then((result) => {
        if (inflight.get(from) !== controller) return;
        inflight.delete(from);
        if (result.ok) {
          cache.set(from, result.window, result.bytes);
          failed.delete(from);
        } else if (result.reason !== "aborted") {
          failed.set(from, { at: deps.clock(), reason: result.reason });
        }
      })
      .catch(() => {
        if (inflight.get(from) === controller) inflight.delete(from);
        failed.set(from, { at: deps.clock(), reason: "invalid" });
      });
  };

  const schedule = (w0: number, real: number): void => {
    const wanted = wantedFor(w0);
    const wantedSet = new Set(wanted);
    for (const [from, controller] of inflight) {
      if (wantedSet.has(from)) continue;
      controller.abort();
      inflight.delete(from);
    }
    if (real < debounceUntil) return;
    for (const from of wanted) {
      if (inflight.size >= maxConcurrent) break;
      if (cache.has(from) || inflight.has(from)) continue;
      const fail = failed.get(from);
      if (fail && real - fail.at < retryAfterMs) continue;
      start(from);
    }
  };

  const publish = (next: ReplayStatus): void => {
    if (
      status &&
      status.loading === next.loading &&
      status.error === next.error &&
      status.noData === next.noData &&
      status.resolution === next.resolution
    )
      return;
    status = next;
    deps.post({ type: "replay", status: next }, []);
  };

  const onTick = (now: number): void => {
    const real = deps.clock();
    const w0 = windowStart(now);

    // Velocidad y sentido del reloj, a partir de lo que avanza entre ticks.
    let jumped = prevW0 === null;
    if (prevNow !== null) {
      const sim = now - prevNow;
      const dReal = real - prevReal;
      if (Math.abs(sim) > 2 * WINDOW_MS) {
        jumped = true; // arrastre o salto de día: no es velocidad de reproducción
        dir = sim > 0 ? 1 : -1;
        lastMoveReal = real;
      } else if (sim !== 0 && dReal > 0) {
        rate = Math.abs(sim) / dReal;
        dir = sim > 0 ? 1 : -1;
        lastMoveReal = real;
      } else if (sim === 0 && real - lastMoveReal > 1000) rate = 0;
    }
    if (prevW0 !== null && Math.abs(w0 - prevW0) > WINDOW_MS) debounceUntil = real + debounceMs;
    prevNow = now;
    prevReal = real;
    prevW0 = w0;

    schedule(w0, real);
    // Lo que queda muy lejos del instante no hace falta (el LRU hace el resto).
    cache.retain((k) => k >= w0 - 16 * WINDOW_MS && k <= w0 + 48 * WINDOW_MS);

    const cur = cache.peek(w0);
    const fail = failed.get(w0);
    if (!cur) {
      publish({
        loading: true,
        error: fail ? fail.reason : null,
        noData: false,
        resolution: null,
      });
      deps.post({ type: "frames", frames: [] }, []);
      return;
    }

    const next = cache.peek(w0 + WINDOW_MS) ?? null;
    if (cur !== activeW0 || next !== activeW1 || !activeSet) {
      activeW0 = cur;
      activeW1 = next;
      activeSet = buildActive(cur, next);
      engine.setActive(activeSet);
    }

    const emitItems = jumped || real - lastItemsAt >= itemsMinMs;
    const out = engine.tick(now, { interpolate: !reduced, emitItems });
    if (emitItems) lastItemsAt = real;
    if (out.reset) deps.post({ type: "reset" }, []);
    for (const event of out.events) deps.post({ type: "items", ...event }, []);
    publish({
      loading: false,
      error: null,
      noData: out.noData,
      resolution: cur.resolution,
    });
    deps.post(
      { type: "frames", frames: out.frames },
      out.frames.flatMap((f) => [
        f.positions.buffer as ArrayBuffer,
        f.headings.buffer as ArrayBuffer,
      ]),
    );
  };

  return (input) => {
    switch (input.type) {
      case "init": {
        reduced = input.reducedMotion;
        loader = deps.createLoader(input.url);
        prevNow = null;
        prevW0 = null;
        rate = 0;
        status = null;
        engine.reset();
        activeW0 = activeW1 = null;
        activeSet = null;
        cache.clear();
        failed.clear();
        for (const c of inflight.values()) c.abort();
        inflight.clear();
        return;
      }
      case "tick":
        if (loader) onTick(input.now);
        else deps.post({ type: "frames", frames: [] }, []);
        return;
      case "reducedMotion":
        reduced = input.value;
        return;
      case "online":
        failed.clear();
        return;
      case "close":
        for (const c of inflight.values()) c.abort();
        inflight.clear();
        cache.clear();
        loader = null;
        return;
    }
  };
}
