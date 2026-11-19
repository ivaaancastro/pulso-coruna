import { ScatterplotLayer } from "@deck.gl/layers";
import { createTranslator, detectLocale } from "../../i18n";
import { paletteAt } from "../../map/palette";
import { createNow } from "../../time/now";
import { createAirCard, type AirCard } from "../air/air-card";
import {
  breath,
  dayBoost,
  haloGain,
  haloRings,
  HIT_MIN_PX,
  HIT_RADIUS_M,
  LEVEL_RGB,
  RINGS_BY_QUALITY,
  readAir,
  type AirLevel,
  type AirReading,
  type Ring,
} from "../air/model";
import type { LiveStoreReader } from "../live-store";
import type { LiveLayerDefinition, QualityLevel } from "../layer-registry";

/**
 * Aire (M5.2c): un halo grande y suave sobre la ciudad cuyo color, intensidad y respiración dependen
 * del EAQI. El dato es de MODELO con una sola celda (~0,4°) para toda la ciudad: no hay variación
 * espacial que dibujar, y una etiqueta «modelo» siempre visible lo dice. Diseño: docs/specs/M5.2c-capa-aire.md.
 */
let card: AirCard | null = null;
let quality: QualityLevel = "high";

function ensureCard(): AirCard {
  if (card) return card;
  const search = window.location.search;
  const locale = detectLocale(search, navigator.languages);
  card = createAirCard({
    parent: document.getElementById("app") ?? document.body,
    t: createTranslator(locale),
    locale,
    now: createNow(search),
  });
  return card;
}

/** Discos del halo en caché: la misma referencia mientras no cambien nivel, calidad ni luz. */
let ringKey = "";
let rings: { data: Ring[]; gain: number } = { data: [], gain: 1 };
function ringsFor(lon: number, lat: number, level: AirLevel, count: number, boost: number) {
  const key = `${lon}|${lat}|${level}|${count}|${boost}`;
  if (key !== ringKey) {
    ringKey = key;
    const data = haloRings(lon, lat, level, count, boost);
    rings = { data, gain: haloGain(data, level, boost) };
  }
  return rings;
}

/** La luz cambia despacio: el refuerzo diurno se recalcula como mucho cada 30 s de reloj de la app. */
let boostKey = -1;
let boostValue = 1;
function boostAt(now: number): number {
  const key = Math.floor(now / 30_000);
  if (key !== boostKey) {
    boostKey = key;
    boostValue = Math.round(dayBoost(paletteAt(now).sunElevation) * 20) / 20;
  }
  return boostValue;
}

/** Lectura en caché: se recalcula solo si llegan datos o pasa un minuto (la capa se evalúa en cada fotograma). */
let readingKey = "";
let cached: AirReading | null = null;
function currentReading(store: LiveStoreReader, now: number): AirReading | null {
  const fresh = store.freshness("air");
  const key = `${fresh?.receivedAt ?? 0}|${store.items("air").size}|${Math.floor(now / 60_000)}`;
  if (key !== readingKey) {
    readingKey = key;
    cached = readAir(store.items("air").values(), now);
    if (cached || card) ensureCard().update(cached);
  }
  return cached;
}

const HIT_DATA: { position: [number, number] }[] = [];
let hitKey = "";
function hitData(lon: number, lat: number) {
  const key = `${lon}|${lat}`;
  if (key !== hitKey) {
    hitKey = key;
    HIT_DATA.splice(0, HIT_DATA.length, { position: [lon, lat] });
  }
  return HIT_DATA;
}

const air: LiveLayerDefinition = {
  id: "air",
  sources: ["air"],
  // La respiración usa reloj propio; con reduced-motion el motor no hace bucle continuo.
  animated: true,
  setQualityLevel(level) {
    quality = level;
  },
  // Sin dato (M4.6): ni etiqueta ni tarjeta con datos fantasma; el pipeline atenúa el halo y lo hace no seleccionable.
  onSourceState(state) {
    card?.suppress(state === "nodata");
  },
  createLayers(ctx) {
    const reading = currentReading(ctx.store, ctx.now);
    if (!reading) return [];

    const animate = !ctx.reducedMotion && quality !== "low";
    const b = breath(reading.level, performance.now(), animate);
    const { data, gain } = ringsFor(
      reading.lon,
      reading.lat,
      reading.level,
      RINGS_BY_QUALITY[quality],
      boostAt(ctx.now),
    );
    const rgb = LEVEL_RGB[reading.level];

    return [
      // Halo: discos concéntricos de alfa casi nulo que se funden; sin trazo.
      new ScatterplotLayer<Ring>({
        id: "air-halo",
        data,
        getPosition: (d) => d.position,
        getRadius: (d) => d.radius,
        getFillColor: (d) => [rgb[0], rgb[1], rgb[2], d.alpha],
        radiusUnits: "meters",
        radiusScale: b.radiusScale,
        opacity: b.opacity * gain,
        stroked: false,
        filled: true,
        pickable: false,
        // Los discos comparten plano: sin prueba de profundidad se mezclan en vez de pelearse (z-fighting).
        parameters: { depthCompare: "always" },
        updateTriggers: { getFillColor: [reading.level] },
      }),
      // Zona de toque de al menos 44 px, casi transparente: abre o cierra la tarjeta.
      new ScatterplotLayer<{ position: [number, number] }>({
        id: "air-hit",
        data: hitData(reading.lon, reading.lat),
        getPosition: (d) => d.position,
        getRadius: HIT_RADIUS_M,
        radiusUnits: "meters",
        radiusMinPixels: HIT_MIN_PX,
        stroked: false,
        filled: true,
        getFillColor: [0, 0, 0, 1], // alfa 1/255: casi invisible pero seleccionable
        pickable: true,
        onClick: () => {
          ensureCard().toggle();
          return true;
        },
      }),
    ];
  },
};

export default air;
