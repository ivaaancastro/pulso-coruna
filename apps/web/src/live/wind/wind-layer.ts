import { LineLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { LiveLayerContext, LiveLayerDefinition } from "../layer-registry";
import { buildArrows, type Arrows } from "./arrows";
import { buildSamples, createWindField, type WindField } from "./field";
import {
  allocateSegmentBuffers,
  DEFAULT_MAX_PARTICLES,
  DEFAULT_TRAIL_POINTS,
  ParticleSystem,
  type SegmentBuffers,
} from "./particles";
import { WIND_WIDTH_PX, windStyle } from "./style";

/** Capa de viento: la definición del registro más el control de calidad para M4.7. */
export interface WindLayerDefinition extends LiveLayerDefinition {
  /** Factor de densidad 0..1 (se recorta a [0,1]; mínimo 0,1): partículas y longitud de estela. */
  setQuality(quality: number): void;
  getQuality(): number;
}

export interface WindLayerOptions {
  /** Partículas con calidad 1. Por defecto 1500, pensado para móvil. */
  maxParticles?: number;
  trailPoints?: number;
  quality?: number;
  rng?: () => number;
  /** Reloj de animación en ms (por defecto `performance.now`). Independiente de `ctx.now`, que puede estar fijado. */
  clock?: () => number;
}

/** Más de 100 ms entre fotogramas (pestaña en segundo plano) no hace saltar las partículas. */
const MAX_DT_MS = 100;
/** Cada cuánto se reconstruye el campo aunque no lleguen datos (para que envejezcan). */
const FIELD_TTL_MS = 30_000;

interface Binary {
  length: number;
  attributes: {
    getSourcePosition: { value: Float32Array; size: 2 };
    getTargetPosition: { value: Float32Array; size: 2 };
    getColor: { value: Uint8Array; size: 4; normalized: true };
  };
}

function segmentLayer(id: string, buffers: SegmentBuffers, count: number): Layer {
  const data: Binary = {
    length: count,
    attributes: {
      getSourcePosition: { value: buffers.source, size: 2 },
      getTargetPosition: { value: buffers.target, size: 2 },
      getColor: { value: buffers.color, size: 4, normalized: true },
    },
  };
  return new LineLayer({
    id,
    data,
    widthUnits: "pixels",
    getWidth: WIND_WIDTH_PX,
    pickable: false,
  });
}

export function createWindLayer(opts: WindLayerOptions = {}): WindLayerDefinition {
  const system = new ParticleSystem({
    maxParticles: opts.maxParticles ?? DEFAULT_MAX_PARTICLES,
    trailPoints: opts.trailPoints ?? DEFAULT_TRAIL_POINTS,
    quality: opts.quality,
    rng: opts.rng,
  });
  // Doble búfer: deck.gl recibe un objeto de datos nuevo y un búfer distinto en cada fotograma.
  const frames = [
    allocateSegmentBuffers(system.maxSegments),
    allocateSegmentBuffers(system.maxSegments),
  ];
  let flip = 0;
  const clock = opts.clock ?? (() => performance.now());
  let lastTick: number | undefined;

  let field: WindField | undefined;
  let fieldKey = "";
  let arrows: { key: string; value: Arrows } | undefined;

  function currentField(ctx: LiveLayerContext): WindField {
    const fresh = ctx.store.freshness("weather");
    const items = ctx.store.items("weather");
    const key = `${fresh?.receivedAt ?? 0}|${items.size}|${Math.floor(ctx.now / FIELD_TTL_MS)}`;
    if (!field || key !== fieldKey) {
      fieldKey = key;
      field = createWindField(buildSamples(items.values(), ctx.now));
    }
    return field;
  }

  return {
    id: "wind",
    sources: ["weather"],
    animated: true,
    setQuality(q) {
      system.setQuality(q);
      arrows = undefined;
    },
    getQuality: () => system.quality,
    createLayers(ctx) {
      const f = currentField(ctx);
      // La animación avanza con reloj propio: `ctx.now` es el reloj de la app (fijable con `?t=`).
      const tick = clock();
      const dtMs = lastTick === undefined ? 0 : Math.min(MAX_DT_MS, Math.max(0, tick - lastTick));
      lastTick = tick;
      if (f.empty) {
        // Sin datos (o caducados): nada que dibujar; al volver, las partículas nacen de nuevo.
        system.reset();
        arrows = undefined;
        return [];
      }
      const style = windStyle(ctx.now);
      if (ctx.reducedMotion) {
        const key = `${fieldKey}|${system.quality}|${style.alpha}`;
        if (arrows?.key !== key) {
          arrows = { key, value: buildArrows(f, system.quality, style.rgb, style.alpha) };
        }
        return arrows.value.count > 0
          ? [segmentLayer("wind-arrows", arrows.value, arrows.value.count)]
          : [];
      }
      arrows = undefined;
      system.step(dtMs / 1000, f);
      flip ^= 1;
      const buffers = frames[flip] as SegmentBuffers;
      const count = system.fill(buffers, style.rgb, style.alpha);
      return count > 0 ? [segmentLayer("wind-flow", buffers, count)] : [];
    },
  };
}
