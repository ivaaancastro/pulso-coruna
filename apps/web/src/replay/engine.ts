import type { Entity, LayerId, LayerItem, Observation, StationStatus } from "@pulso/schema";
import type { ItemsEvent, MobileFrame } from "../live/types";
import {
  locate,
  mobilePolicy,
  samplePose,
  type ActiveSet,
  type MobileSeries,
  type Pose,
} from "./series";

/** Resultado de un instante: fotogramas interpolados, cambios de elementos y si hubo que reiniciar. */
export interface EngineTick {
  /** El instante retrocedió o es el primero: el espejo del hilo principal debe vaciarse antes. */
  reset: boolean;
  frames: MobileFrame[];
  events: ItemsEvent[];
  /** Hay ventana pero ni un solo dato (ni estado inicial) en este instante. */
  noData: boolean;
}

export interface TickOptions {
  /** Interpolar entre muestras (false con reduced-motion: cada muestra tal cual). */
  interpolate: boolean;
  /** Emitir cambios de elementos (tarjetas, frescura): se limita a pocas veces por segundo. */
  emitItems: boolean;
}

/**
 * Motor de reproducción: dado un instante, calcula lo mismo que el motor en vivo entrega a las
 * capas (`MobileFrame` para los móviles, `ItemsEvent` para el resto y para los metadatos), pero
 * como función del tiempo y no de la llegada de mensajes. Puro: sin red, sin DOM, sin reloj.
 *
 * - Móviles: fotograma interpolado en `now` (también hacia atrás o a saltos).
 * - Elementos (`Entity`, `StationStatus`, `Observation`): el último valor ≤ `now`. Hacia delante
 *   se emiten solo los cambios; si el instante retrocede se reinicia (el almacén no admite que un
 *   dato «rejuvenezca»).
 */
export class ReplayEngine {
  private set: ActiveSet | null = null;
  private lastNow: number | null = null;
  private lastFrameNow: number | null = null;
  private setChanged = false;
  private pendingReset = true;
  /** capa → clave → `ts` del elemento ya emitido. */
  private readonly emitted = new Map<LayerId, Map<string, number>>();
  private readonly ids = new Map<LayerId, { ids: string[]; version: number; sent: number }>();
  private readonly pose: Pose & { index: number } = { lon: 0, lat: 0, heading: 0, index: 0 };

  /** Sustituye las series activas (otra ventana). `null`: no hay ventana para este instante. */
  setActive(set: ActiveSet | null): void {
    if (set === this.set) return;
    this.set = set;
    this.setChanged = true;
  }

  get active(): ActiveSet | null {
    return this.set;
  }

  /** Olvida todo (cambio de día, salida del modo). */
  reset(): void {
    this.set = null;
    this.lastNow = null;
    this.lastFrameNow = null;
    this.pendingReset = true;
    this.emitted.clear();
    this.ids.clear();
  }

  tick(now: number, opts: TickOptions): EngineTick {
    const set = this.set;
    if (!set) return { reset: false, frames: [], events: [], noData: false };
    // Un retroceso pide reiniciar el espejo, pero solo cuando toca emitir elementos: arrastrando
    // hacia atrás los fotogramas siguen a cada tick y los elementos se actualizan a ritmo limitado.
    if (this.lastNow === null || now < this.lastNow) this.pendingReset = true;
    const reset = this.pendingReset && (opts.emitItems || this.lastNow === null);
    if (reset) {
      this.pendingReset = false;
      this.emitted.clear();
      // El espejo vació sus fotogramas: los `ids` deben volver a viajar en el siguiente.
      this.ids.clear();
    }
    this.lastNow = now;

    const frames: MobileFrame[] = [];
    const events: ItemsEvent[] = [];
    let total = 0;
    const wantFrame = this.setChanged || reset || this.lastFrameNow !== now;

    // Móviles.
    for (const [layer, list] of set.mobile) {
      const policy = mobilePolicy(layer);
      const alive: number[] = [];
      const index: number[] = [];
      // Dos pasadas: contar y rellenar (los buffers se ceden al hilo principal, no se reutilizan).
      const poses: number[] = [];
      for (let k = 0; k < list.length; k++) {
        const s = list[k] as MobileSeries;
        if (!samplePose(s, now, policy, opts.interpolate, this.pose)) continue;
        alive.push(k);
        index.push(this.pose.index);
        poses.push(this.pose.lon, this.pose.lat, this.pose.heading);
      }
      total += alive.length;

      if (wantFrame) {
        const positions = new Float32Array(alive.length * 2);
        const headings = new Float32Array(alive.length);
        for (let n = 0; n < alive.length; n++) {
          positions[n * 2] = poses[n * 3] as number;
          positions[n * 2 + 1] = poses[n * 3 + 1] as number;
          headings[n] = poses[n * 3 + 2] as number;
        }
        const ids = alive.map((k) => (list[k] as MobileSeries).id);
        const prev = this.ids.get(layer);
        const same =
          prev !== undefined &&
          prev.ids.length === ids.length &&
          prev.ids.every((id, n) => id === ids[n]);
        const entry = same ? prev : { ids, version: (prev?.version ?? 0) + 1, sent: -1 };
        this.ids.set(layer, entry);
        const changed = entry.sent !== entry.version;
        entry.sent = entry.version;
        frames.push({
          layer,
          count: alive.length,
          idsVersion: entry.version,
          ids: changed ? entry.ids : null,
          positions,
          headings,
        });
      }

      if (opts.emitItems || reset) {
        const items = new Map<string, number>();
        const build = new Map<string, () => Entity>();
        for (let n = 0; n < alive.length; n++) {
          const s = list[alive[n] as number] as MobileSeries;
          const i = index[n] as number;
          items.set(s.id, s.t[i] as number);
          build.set(s.id, () => entityOf(layer, s, i));
        }
        this.diff(layer, items, (key) => (build.get(key) as () => Entity)(), now, events, reset);
      }
    }

    // Estaciones de bicis.
    {
      const items = new Map<string, number>();
      const build = new Map<string, () => LayerItem>();
      for (const st of set.stations) {
        const i = locate(st.t, now);
        if (i < 0) continue;
        items.set(st.id, st.t[i] as number);
        build.set(st.id, (): StationStatus => ({
          id: st.id,
          layer: "bike",
          lon: st.lon,
          lat: st.lat,
          bikes: st.bikes[i] as number,
          docks: st.docks[i] as number,
          ts: st.t[i] as number,
        }));
      }
      total += items.size;
      if (set.stations.length > 0 && (opts.emitItems || reset)) {
        this.diff(
          "bike",
          items,
          (key) => (build.get(key) as () => LayerItem)(),
          now,
          events,
          reset,
        );
      }
    }

    // Observaciones (meteo, mar, aire).
    for (const [layer, list] of set.series) {
      const items = new Map<string, number>();
      const build = new Map<string, () => LayerItem>();
      for (const se of list) {
        const i = locate(se.t, now);
        if (i < 0) continue;
        const key = `${se.stationId}:${se.metric}`;
        items.set(key, se.t[i] as number);
        build.set(key, (): Observation => ({
          stationId: se.stationId,
          layer: layer as Observation["layer"],
          metric: se.metric,
          value: se.v[i] as number,
          unit: se.unit,
          ts: se.t[i] as number,
        }));
      }
      total += items.size;
      if (opts.emitItems || reset) {
        this.diff(layer, items, (key) => (build.get(key) as () => LayerItem)(), now, events, reset);
      }
    }

    // Capas pedidas que no traen ningún elemento (o que ya no lo traen): quedan vacías, y el
    // reinicio las declara explícitamente para que M4.6 las trate como «sin datos».
    if (opts.emitItems || reset) {
      const handled = new Set<LayerId>(set.mobile.keys());
      for (const l of set.series.keys()) handled.add(l);
      if (set.stations.length > 0) handled.add("bike");
      for (const layer of new Set<LayerId>([...set.layers, ...this.emitted.keys()])) {
        if (handled.has(layer)) continue;
        this.diff(layer, new Map(), () => undefined as never, now, events, reset);
      }
    }

    this.lastFrameNow = now;
    this.setChanged = false;
    return { reset, frames, events, noData: total === 0 };
  }

  /** Compara con lo ya emitido y añade el evento de cambios (o de sustitución si `replace`). */
  private diff(
    layer: LayerId,
    current: Map<string, number>,
    build: (key: string) => LayerItem,
    now: number,
    events: ItemsEvent[],
    replace: boolean,
  ): void {
    const before = this.emitted.get(layer) ?? new Map<string, number>();
    const upserts: LayerItem[] = [];
    const removes: string[] = [];
    let dataTs = 0;
    for (const [key, ts] of current) {
      if (before.get(key) !== ts) {
        const item = build(key);
        upserts.push(item);
        if (ts > dataTs) dataTs = ts;
      }
    }
    if (!replace) for (const key of before.keys()) if (!current.has(key)) removes.push(key);
    this.emitted.set(layer, current);
    if (replace || upserts.length > 0 || removes.length > 0) {
      events.push({ layer, replace, upserts, removes, receivedAt: now, dataTs });
    }
  }
}

function entityOf(layer: LayerId, s: MobileSeries, i: number): Entity {
  const heading = s.heading[i] as number;
  const speed = s.speed[i] as number;
  return {
    id: s.id,
    layer: layer as Entity["layer"],
    lon: s.lon[i] as number,
    lat: s.lat[i] as number,
    ...(Number.isNaN(heading) ? {} : { heading }),
    ...(Number.isNaN(speed) ? {} : { speed }),
    ts: s.t[i] as number,
    ...(s.meta ? { meta: s.meta } : {}),
  };
}
