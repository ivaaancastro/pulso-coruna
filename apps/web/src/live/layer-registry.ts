import type { Layer } from "@deck.gl/core";
import type { LayerId } from "@pulso/schema";
import type { LiveStoreReader } from "./live-store";
import type { SourceState } from "./source-status";

/**
 * Registro único de capas en vivo (bus, bici, viento…). Cada capa es un fichero propio en
 * `src/live/layers/<nombre>.layer.ts` que exporta por defecto su `LiveLayerDefinition`; se
 * descubre solo (sin tocar este módulo ni los de otras capas) y solo se carga si hay capas.
 *
 * ```ts
 * // src/live/layers/bus.layer.ts
 * import { ScatterplotLayer } from "@deck.gl/layers";
 * import type { LiveLayerDefinition } from "../layer-registry";
 * const bus: LiveLayerDefinition = {
 *   id: "bus",
 *   sources: ["bus"],
 *   createLayers: ({ store }) => {
 *     const frame = store.frame("bus");
 *     if (!frame) return [];
 *     return [new ScatterplotLayer({
 *       id: "bus",
 *       data: { length: frame.count, attributes: { getPosition: { value: frame.positions, size: 2 } } },
 *       ...
 *     })];
 *   },
 * };
 * export default bus;
 * ```
 */
export interface LiveLayerContext {
  store: LiveStoreReader;
  /** Hora de la app (UTC epoch ms), del reloj de `time/now.ts`. */
  now: number;
  /** `prefers-reduced-motion: reduce`: sin movimiento continuo ni transiciones largas. */
  reducedMotion: boolean;
  /**
   * Pide recalcular esta capa en el siguiente fotograma, para cambios que no vienen de los datos
   * (p. ej. la estación seleccionada). Seguro de llamar desde manejadores de eventos.
   */
  invalidate(): void;
}

export interface LiveLayerDefinition {
  /** Identificador único de la capa visual. */
  id: string;
  /** Capas de datos a las que se suscribe: `createLayers` se reevalúa cuando cambian. */
  sources: readonly LayerId[];
  /** Reevaluar en cada fotograma aunque no cambien los datos (partículas, transiciones por tiempo). */
  animated?: boolean;
  /** Crea las capas deck.gl a partir del estado actual. Debe ser barata y sin efectos laterales. */
  createLayers(ctx: LiveLayerContext): Layer[];
  /**
   * Opcional (M4.6): la fuente cambió de estado (`live`, `delayed`, `nodata`, `disconnected`). La
   * atenuación la aplica el pipeline; esto sirve para soltar estado propio, p. ej. cerrar la
   * tarjeta abierta cuando pasa a `nodata` para no dejar datos fantasma.
   */
  onSourceState?(state: SourceState): void;
}

const definitions = new Map<string, LiveLayerDefinition>();

export function registerLiveLayer(definition: LiveLayerDefinition): void {
  const existing = definitions.get(definition.id);
  if (existing && existing !== definition) {
    throw new Error(`Capa en vivo duplicada: ${definition.id}`);
  }
  definitions.set(definition.id, definition);
}

export function listLiveLayers(): LiveLayerDefinition[] {
  return [...definitions.values()];
}

/** Solo para tests. */
export function resetLiveLayers(): void {
  definitions.clear();
}

type LayerModule = { default?: LiveLayerDefinition };

/** Descubrimiento: cada `layers/*.layer.ts` es su propio chunk diferido. */
const discovered = import.meta.glob<LayerModule>("./layers/*.layer.ts");

/** ¿Hay capas registradas o por descubrir? Sin ninguna no se arranca stream ni deck.gl. */
export function hasLiveLayers(): boolean {
  return definitions.size > 0 || Object.keys(discovered).length > 0;
}

/** Carga y registra las capas descubiertas; devuelve todas las registradas. */
export async function loadLiveLayers(): Promise<LiveLayerDefinition[]> {
  const modules = await Promise.all(Object.values(discovered).map((load) => load()));
  for (const mod of modules) if (mod.default) registerLiveLayer(mod.default);
  return listLiveLayers();
}
