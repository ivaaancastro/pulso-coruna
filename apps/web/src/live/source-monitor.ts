import type { LayerId } from "@pulso/schema";
import { defaultFetchHealth, parseHealth, type FetchHealth, type HealthLastData } from "./health";
import type { LiveChange, LiveStoreReader } from "./live-store";
import {
  isDisconnected,
  layerStatus,
  SOURCE_THRESHOLDS,
  worstState,
  type LayerStatus,
  type SourceState,
  type Thresholds,
} from "./source-status";

export interface MonitorStore extends LiveStoreReader {
  subscribe(listener: (change: LiveChange) => void): () => void;
}

export interface SourceMonitorOptions {
  store: MonitorStore;
  /** Capas vigiladas (las que tienen una definición registrada). */
  layers: readonly LayerId[];
  /** Reloj de la app (`time/now.ts`). */
  now: () => number;
  /** Reloj real, para medir cuánto lleva caída la conexión (el de la app puede estar fijado). */
  clock?: () => number;
  thresholds?: Readonly<Record<LayerId, Thresholds>>;
  /** URL de `/api/v1/health` de nuestra API; sin ella no se sondea. */
  healthUrl?: string | null;
  fetchHealth?: FetchHealth;
  /** Cada cuánto se reevalúa el paso del tiempo sin mensajes. */
  tickMs?: number;
  pollMs?: number;
  pollMaxMs?: number;
  visible?: () => boolean;
}

export interface SourceMonitor {
  status(layer: LayerId): LayerStatus;
  /** Estado conjunto de varias capas (el peor). */
  stateOf(layers: readonly LayerId[]): SourceState;
  readonly layers: readonly LayerId[];
  /** ¿Nuestra conexión lleva caída más allá de la gracia? */
  readonly disconnected: boolean;
  /** Notifica cuando cambia el estado de alguna capa. */
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
}

const LIVE: LayerStatus = { state: "live", lastDataAt: null };

/**
 * Alimenta el modelo puro (`source-status.ts`) con lo que hay: frescura del almacén, estado de la
 * conexión y, solo si hace falta, `/api/v1/health` (nuestra API, nunca terceros). Se reevalúa con
 * cada cambio del almacén y cada `tickMs`, y avisa únicamente cuando cambia algún estado.
 */
export function createSourceMonitor(opts: SourceMonitorOptions): SourceMonitor {
  const clock = opts.clock ?? Date.now;
  const thresholds = opts.thresholds ?? SOURCE_THRESHOLDS;
  const tickMs = opts.tickMs ?? 5000;
  const pollBase = opts.pollMs ?? 60_000;
  const pollMax = opts.pollMaxMs ?? 600_000;
  const fetchHealth = opts.fetchHealth ?? defaultFetchHealth;
  const visible =
    opts.visible ??
    (() => typeof document === "undefined" || document.visibilityState !== "hidden");

  const listeners = new Set<() => void>();
  const current = new Map<LayerId, LayerStatus>();
  let health: HealthLastData = {};
  let downSince: number | null = null;
  let disc = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollDelay = pollBase;
  let inflight: AbortController | null = null;
  let unsubscribe: (() => void) | null = null;
  let running = false;

  /** Caída = reconectando, cerrada, o «abierta» pero sin haber recibido aún nada tras reconectar. */
  const isDown = (): boolean => {
    const { state, attempt } = opts.store.connection;
    return state === "reconnecting" || state === "closed" || (state === "open" && attempt > 0);
  };

  const connection = () => ({
    state: isDown() ? ("reconnecting" as const) : opts.store.connection.state,
    downForMs: downSince === null ? 0 : Math.max(0, clock() - downSince),
  });

  const trackConnection = (): void => {
    if (isDown()) downSince ??= clock();
    else if (opts.store.connection.state === "open") downSince = null;
  };

  const evaluate = (): void => {
    const now = opts.now();
    const conn = connection();
    let changed = false;
    for (const layer of opts.layers) {
      const next = layerStatus({
        now,
        freshness: opts.store.freshness(layer),
        connection: conn,
        healthLastDataAt: health[layer],
        thresholds: thresholds[layer],
      });
      const prev = current.get(layer);
      if (!prev || prev.state !== next.state || prev.lastDataAt !== next.lastDataAt) changed = true;
      current.set(layer, next);
    }
    // La desconexión también se avisa aunque ninguna capa tenga dato aún (el servidor no llega a abrir).
    const nowDisc = isDisconnected(conn);
    if (nowDisc !== disc) changed = true;
    disc = nowDisc;
    if (changed) for (const l of [...listeners]) l();
    schedulePoll();
  };

  /** Solo se sondea /health mientras alguna capa no tenga marca de dato propia. */
  const needsHealth = (): boolean =>
    opts.layers.some((l) => {
      const f = opts.store.freshness(l);
      return !f || !(f.dataTs > 0);
    }) && opts.store.connection.state === "open";

  function schedulePoll(): void {
    if (!running || !opts.healthUrl || pollTimer !== null || !needsHealth()) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void poll();
    }, pollDelay);
  }

  async function poll(): Promise<void> {
    const url = opts.healthUrl;
    if (!running || !url || !needsHealth() || !visible()) {
      schedulePoll();
      return;
    }
    inflight = new AbortController();
    try {
      const parsed = parseHealth(await fetchHealth(url, inflight.signal));
      if (!running) return;
      if (parsed) {
        health = parsed;
        pollDelay = pollBase;
      } else pollDelay = Math.min(pollMax, pollDelay * 2);
    } catch {
      if (!running) return;
      pollDelay = Math.min(pollMax, pollDelay * 2);
    } finally {
      inflight = null;
    }
    evaluate();
  }

  return {
    layers: opts.layers,
    status: (layer) => current.get(layer) ?? LIVE,
    stateOf: (layers) => worstState(layers.map((l) => (current.get(l) ?? LIVE).state)),
    get disconnected() {
      return disc;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (running) return;
      running = true;
      trackConnection();
      unsubscribe = opts.store.subscribe((change) => {
        if (change.kind === "frames") return;
        trackConnection();
        evaluate();
      });
      timer = setInterval(evaluate, tickMs);
      evaluate();
    },
    stop() {
      running = false;
      unsubscribe?.();
      unsubscribe = null;
      if (timer) clearInterval(timer);
      if (pollTimer) clearTimeout(pollTimer);
      timer = pollTimer = null;
      inflight?.abort();
      listeners.clear();
    },
  };
}
