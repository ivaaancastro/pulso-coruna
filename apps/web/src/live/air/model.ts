import type { LayerItem, Observation } from "@pulso/schema";
import { AIR_STATIONS, isModelStation } from "./stations";

/**
 * Lógica pura de la capa de aire (sin deck.gl ni DOM). Los colores salen de docs/design/tokens.md
 * (`--pulso-air`, `--pulso-warn`, `--pulso-error`). El dato es de MODELO con una sola celda para toda
 * la ciudad: no hay variación espacial, solo un halo centrado cuyo aspecto depende del EAQI.
 */
export type AirLevel = 1 | 2 | 3 | 4 | 5 | 6;
export const AIR_LEVELS: readonly AirLevel[] = [1, 2, 3, 4, 5, 6];

export type Rgb = readonly [number, number, number];

/** `--pulso-air` #A78BFA. */
export const AIR_RGB: Rgb = [167, 139, 250];
/** `--pulso-warn` #FFB020. */
export const WARN_RGB: Rgb = [255, 176, 32];
/** `--pulso-error` #FF6B6B. */
export const ERROR_RGB: Rgb = [255, 107, 107];

export const ATTRIBUTION = "Open-Meteo.com (datos CAMS)";
export const ATTRIBUTION_URL = "https://open-meteo.com/";

export type Pollutant = "pm25" | "pm10" | "no2" | "o3" | "so2";
/** Orden de la tarjeta y símbolo de cada contaminante (símbolos químicos: no se traducen). */
export const POLLUTANTS: readonly { metric: Pollutant; label: string }[] = [
  { metric: "pm25", label: "PM2.5" },
  { metric: "pm10", label: "PM10" },
  { metric: "no2", label: "NO₂" },
  { metric: "o3", label: "O₃" },
  { metric: "so2", label: "SO₂" },
];

/**
 * El adaptador emite `european_aqi` de Open-Meteo: escala numérica (0–100+), no 1–6. Tramos
 * europeos: ≤20 buena, ≤40 razonable, ≤60 moderada, ≤80 mala, ≤100 muy mala, >100 extremadamente mala.
 */
export function eaqiLevel(value: number): AirLevel | null {
  if (!Number.isFinite(value) || value < 0) return null;
  if (value <= 20) return 1;
  if (value <= 40) return 2;
  if (value <= 60) return 3;
  if (value <= 80) return 4;
  if (value <= 100) return 5;
  return 6;
}

export interface AirValue {
  value: number;
  unit: string;
}

export interface AirReading {
  stationId: string;
  lon: number;
  lat: number;
  /** `true`: el dato es de modelo (sufijo `:model`), no de medición. */
  model: boolean;
  eaqi: number;
  level: AirLevel;
  /** Marca del dato (epoch ms UTC): la hora del modelo. */
  ts: number;
  pollutants: Partial<Record<Pollutant, AirValue>>;
}

const isObservation = (item: LayerItem): item is Observation =>
  "metric" in item && "stationId" in item;

/** Un dato más viejo que esto no se dibuja (= `nodataMs` de `air`): así no hace falta que el pipeline avise del estado inicial. */
export const MAX_AGE_MS = 4 * 3_600_000;

/**
 * Lectura vigente: la del punto conocido con `eaqi` válido más reciente. Sin `eaqi` no hay lectura
 * (no se deduce de los contaminantes). Los contaminantes son los del mismo punto.
 */
export function readAir(items: Iterable<LayerItem>, now: number): AirReading | null {
  const byStation = new Map<string, Map<string, Observation>>();
  for (const item of items) {
    if (!isObservation(item) || item.layer !== "air") continue;
    if (!AIR_STATIONS[item.stationId]) continue;
    let metrics = byStation.get(item.stationId);
    if (!metrics) byStation.set(item.stationId, (metrics = new Map()));
    const prev = metrics.get(item.metric);
    if (!prev || item.ts >= prev.ts) metrics.set(item.metric, item);
  }
  let best: AirReading | null = null;
  for (const [stationId, metrics] of byStation) {
    const eaqi = metrics.get("eaqi");
    const station = AIR_STATIONS[stationId];
    if (!eaqi || !station) continue;
    if (now - eaqi.ts > MAX_AGE_MS) continue;
    const level = eaqiLevel(eaqi.value);
    if (level === null) continue;
    if (best && best.ts >= eaqi.ts) continue;
    const pollutants: AirReading["pollutants"] = {};
    for (const { metric } of POLLUTANTS) {
      const o = metrics.get(metric);
      if (o && Number.isFinite(o.value)) pollutants[metric] = { value: o.value, unit: o.unit };
    }
    best = {
      stationId,
      lon: station.lon,
      lat: station.lat,
      model: isModelStation(stationId),
      eaqi: eaqi.value,
      level,
      ts: eaqi.ts,
      pollutants,
    };
  }
  return best;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Escala sobria buena→mala solo con tokens: air, air, air/warn, warn, warn/error, error. */
export const LEVEL_RGB: Readonly<Record<AirLevel, Rgb>> = {
  1: AIR_RGB,
  2: AIR_RGB,
  3: mix(AIR_RGB, WARN_RGB, 0.5),
  4: WARN_RGB,
  5: mix(WARN_RGB, ERROR_RGB, 0.5),
  6: ERROR_RGB,
};

export const rgbCss = (rgb: Rgb): string => `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;

/** Aspecto del halo por nivel: opacidad pico en el centro, radio (m) y amplitud de la respiración. */
export interface LevelStyle {
  peak: number;
  radiusM: number;
  breath: number;
}

export const LEVEL_STYLE: Readonly<Record<AirLevel, LevelStyle>> = {
  1: { peak: 0.26, radiusM: 2000, breath: 0.02 },
  2: { peak: 0.29, radiusM: 2300, breath: 0.03 },
  3: { peak: 0.32, radiusM: 2600, breath: 0.05 },
  4: { peak: 0.36, radiusM: 2900, breath: 0.07 },
  5: { peak: 0.4, radiusM: 3200, breath: 0.09 },
  6: { peak: 0.44, radiusM: 3500, breath: 0.11 },
};

/** Periodo de la respiración, ms (docs/design/direccion.md: pulso de 6 s). */
export const BREATH_PERIOD_MS = 6000;

/** Discos concéntricos por nivel de calidad (M4.7). */
export const RINGS_BY_QUALITY = { high: 24, medium: 14, low: 8 } as const;

/** Radio de la zona de toque (m) y mínimo en píxeles (44 px de diámetro: objetivo táctil mínimo). */
export const HIT_RADIUS_M = 1500;
export const HIT_MIN_PX = 22;

/** Opacidad máxima de la capa con el sol alto frente a la noche. */
export const DAY_BOOST = 1.3;

export interface Ring {
  position: [number, number];
  /** Radio en metros. */
  radius: number;
  /** Alfa 0–255 de este disco. */
  alpha: number;
}

/**
 * Discos concéntricos con alfa repartido para que el centro acumule `peak` y el borde se funda a 0:
 * 1-(1-peak)^(1/n) por disco. `boost` multiplica el pico (de día), con tope 0,9.
 */
export function haloRings(
  lon: number,
  lat: number,
  level: AirLevel,
  count: number,
  boost = 1,
): Ring[] {
  const style = LEVEL_STYLE[level];
  const n = Math.max(1, Math.round(count));
  const peak = Math.min(0.9, style.peak * boost);
  const perRing = 1 - Math.pow(1 - peak, 1 / n);
  // Hacia arriba: el alfa de un byte es grueso (2/255 ≈ 0,8 % por disco); `haloGain` ajusta el resto.
  const alpha = Math.ceil(255 * perRing);
  const rings: Ring[] = [];
  for (let i = 1; i <= n; i++) {
    rings.push({ position: [lon, lat], radius: (style.radiusM * i) / n, alpha });
  }
  return rings;
}

/** Opacidad acumulada en el centro de los discos (todos se solapan ahí). */
export function centreOpacity(rings: readonly Ring[]): number {
  return 1 - rings.reduce((acc, r) => acc * (1 - r.alpha / 255), 1);
}

/** Factor (≤ 1) de la opacidad de la capa que devuelve el pico exacto del nivel tras redondear el alfa. */
export function haloGain(rings: readonly Ring[], level: AirLevel, boost = 1): number {
  const target = Math.min(0.9, LEVEL_STYLE[level].peak * boost);
  const actual = centreOpacity(rings);
  return actual > 0 ? Math.min(1, target / actual) : 1;
}

export interface Breath {
  /** Multiplica el radio del halo (≥ 1). */
  radiusScale: number;
  /** Multiplica la opacidad de la capa (≤ 1). */
  opacity: number;
}

/**
 * Respiración: al inspirar el halo crece y se aclara un poco. `p` es 0 (reposo) a 1 (máximo), con
 * ease coseno sobre el periodo. Sin movimiento (`animate` falso) siempre es el reposo.
 */
export function breath(level: AirLevel, clockMs: number, animate: boolean): Breath {
  if (!animate) return { radiusScale: 1, opacity: 1 };
  const amp = LEVEL_STYLE[level].breath;
  const phase = (clockMs % BREATH_PERIOD_MS) / BREATH_PERIOD_MS;
  const p = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  return { radiusScale: 1 + amp * p, opacity: 1 - 2 * amp * p };
}

/** Refuerzo diurno suave (1 de noche, hasta `DAY_BOOST` con el sol alto) → multiplicador de opacidad. */
export function dayBoost(elevation: number): number {
  const c = Math.min(1, Math.max(0, (elevation + 6) / 18));
  const smooth = c * c * (3 - 2 * c);
  return 1 + (DAY_BOOST - 1) * smooth;
}
