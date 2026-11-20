import { createHash } from "node:crypto";
import {
  PULSE_DEFAULT_STEP_MS,
  PULSE_LAYER_MAX,
  PULSE_MAX_STEP_MS,
  PULSE_MAX_WINDOW_MS,
  PULSE_MIN_STEP_MS,
  PULSE_VERSION,
  type Pulse,
  type PulsePoint,
} from "@pulso/schema";
import { REPLAY_SETTLE_MS, parseMs } from "./replay.js";

/**
 * Índice Pulso (M7.2, `docs/specs/M7.2-indice-pulso.md`, ADR-0026). Todo este módulo es PURO: recibe agregados
 * ya leídos de la BD (`PulseAggregates`) y devuelve la serie. Tiempos en epoch ms UTC; la zona `Europe/Madrid`
 * solo sirve para elegir el perfil (día-tipo y hora) de «lo habitual».
 */

const DAY_MS = 86_400_000;

/** Capas que entran en el índice (`train` no tiene fuente). */
export const PULSE_LAYERS = ["bus", "bike", "weather", "sea", "ship", "air", "plane"] as const;
export type PulseLayer = (typeof PULSE_LAYERS)[number];
export type PulseWeights = Record<PulseLayer, number>;

/** Pesos por defecto: lo que mueve la ciudad pesa más; el entorno (tiempo, mar, aire) apenas desplaza el índice. */
export const DEFAULT_PULSE_WEIGHTS: PulseWeights = {
  bus: 1,
  bike: 1,
  ship: 0.4,
  plane: 0.4,
  weather: 0.3,
  air: 0.3,
  sea: 0.2,
};

const isPulseLayer = (k: string): k is PulseLayer =>
  (PULSE_LAYERS as readonly string[]).includes(k);

/**
 * `PULSE_WEIGHTS`: JSON `{"bus":1.5,"sea":0}` con capas conocidas y números ≥ 0; lo no indicado usa el
 * valor por defecto; `0` desactiva la capa. Lanza `Error` si es inválido o si todos los pesos son 0.
 */
export function parsePulseWeights(raw: string | undefined): PulseWeights {
  const weights = { ...DEFAULT_PULSE_WEIGHTS };
  if (raw !== undefined && raw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('PULSE_WEIGHTS debe ser un JSON válido (p. ej. {"bus":1.5})');
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("PULSE_WEIGHTS debe ser un objeto JSON {capa: peso}");
    for (const [k, v] of Object.entries(parsed)) {
      if (!isPulseLayer(k))
        throw new Error(
          `PULSE_WEIGHTS: capa desconocida "${k}" (válidas: ${PULSE_LAYERS.join(", ")})`,
        );
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100)
        throw new Error(`PULSE_WEIGHTS: el peso de "${k}" debe ser un número entre 0 y 100`);
      weights[k] = v;
    }
  }
  if (PULSE_LAYERS.every((l) => weights[l] === 0))
    throw new Error("PULSE_WEIGHTS: al menos una capa debe tener peso > 0");
  return weights;
}

// ---------------------------------------------------------------------------------------------
// Perfil fijo: «lo habitual» por capa, día-tipo y hora (Europe/Madrid)
// ---------------------------------------------------------------------------------------------

export type DayType = "weekday" | "saturday" | "sunday";
export const DAY_TYPES: readonly DayType[] = ["weekday", "saturday", "sunday"];

/** Forma diaria de la actividad urbana (bus, bici): fracción del pico de un laborable, por hora local 0–23. */
const URBAN: Record<DayType, readonly number[]> = {
  // prettier-ignore
  weekday: [0.04, 0.02, 0.02, 0.02, 0.03, 0.12, 0.4, 0.8, 1, 0.85, 0.75, 0.75, 0.8, 0.85, 0.8, 0.75, 0.85, 0.95, 1, 0.8, 0.5, 0.3, 0.15, 0.08],
  // prettier-ignore
  saturday: [0.08, 0.05, 0.03, 0.02, 0.02, 0.05, 0.12, 0.25, 0.45, 0.65, 0.8, 0.85, 0.85, 0.8, 0.75, 0.75, 0.8, 0.85, 0.85, 0.75, 0.55, 0.4, 0.25, 0.15],
  // prettier-ignore
  sunday: [0.1, 0.06, 0.03, 0.02, 0.02, 0.03, 0.06, 0.1, 0.18, 0.3, 0.45, 0.55, 0.6, 0.6, 0.55, 0.55, 0.55, 0.55, 0.5, 0.4, 0.3, 0.2, 0.12, 0.06],
};
/** Barcos y aviones: más planos a lo largo del día (puerto y aeropuerto no duermen), algo menos en fin de semana. */
// prettier-ignore
const TRANSPORT_WEEKDAY = [0.3, 0.25, 0.2, 0.2, 0.2, 0.3, 0.45, 0.65, 0.85, 1, 1, 1, 1, 1, 1, 1, 1, 0.95, 0.9, 0.8, 0.65, 0.5, 0.4, 0.35];
const scaled = (a: readonly number[], k: number): number[] =>
  a.map((v) => Math.round(v * k * 1000) / 1000);
const TRANSPORT: Record<DayType, readonly number[]> = {
  weekday: TRANSPORT_WEEKDAY,
  saturday: scaled(TRANSPORT_WEEKDAY, 0.9),
  sunday: scaled(TRANSPORT_WEEKDAY, 0.75),
};

type ActivityLayer = "bus" | "bike" | "ship" | "plane";

/**
 * Perfil fijo v1. `peak` = actividad típica en el pico de un laborable (ESTIMACIÓN, no medida): nº de
 * entidades en movimiento por tramo (bus, ship, plane) y cambios de bicis por 5 min en toda la red (bike).
 * `shape` = fracción del pico por día-tipo y hora. «Lo habitual» = `peak × shape`. Se sustituirá por el
 * perfil aprendido (ADR-0026) tras ≥ 1 mes de histórico.
 */
export const FIXED_PROFILE = {
  peak: { bus: 40, bike: 25, ship: 6, plane: 3 } satisfies Record<ActivityLayer, number>,
  shape: { bus: URBAN, bike: URBAN, ship: TRANSPORT, plane: TRANSPORT } satisfies Record<
    ActivityLayer,
    Record<DayType, readonly number[]>
  >,
} as const;

/** Suavizado (+1 entidad/cambio) para que «lo habitual» casi nulo de madrugada no dispare el cociente. */
const SMOOTHING = 1;
/** Una entidad cuenta como «en movimiento» con velocidad ≥ 0,5 m/s o si la fuente no informa velocidad. */
export const MOVING_SPEED_MS = 0.5;
/** Normalización de la rotación de bicis: cambios por 5 min. */
export const BIKE_REF_STEP_MS = 5 * 60_000;
/** Dos lecturas de una estación separadas más que esto no forman un cambio (ingesta caída). */
export const BIKE_MAX_GAP_MS = 15 * 60_000;
/** Un tramo en curso con menos de este tiempo transcurrido no extrapola la rotación de bicis. */
const MIN_PARTIAL_MS = 60_000;

/** Qué es «normal» y cuánto es mucho, por capa y métrica (desviación = (valor − normal) / escala). */
export const OBSERVATION_NORMALS: Record<
  "weather" | "air" | "sea",
  Record<string, { normal: number; scale: number }>
> = {
  weather: {
    wind_speed: { normal: 4, scale: 4 }, // m/s
    wind_gust: { normal: 7, scale: 6 }, // m/s
    rain_10m: { normal: 0, scale: 1 }, // mm/10 min
  },
  air: {
    pm10: { normal: 20, scale: 20 }, // µg/m³
    pm25: { normal: 10, scale: 10 },
    no2: { normal: 25, scale: 25 },
    o3: { normal: 60, scale: 40 },
  },
  sea: {
    tide_level: { normal: 2.2, scale: 1.5 }, // m
  },
};
/** Una capa ambiental mueve su razón como mucho ±0,25 por desviación típica y ±0,5 en total. */
const OBSERVATION_GAIN = 0.25;
const MAX_DEVIATION = 2;

// ---------------------------------------------------------------------------------------------
// Día-tipo y hora local
// ---------------------------------------------------------------------------------------------

const MADRID = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Día-tipo (laborable/sábado/domingo; sin festivos) y hora local 0–23 en `Europe/Madrid` de un instante UTC. */
export function localSlot(ts: number): { dayType: DayType; hour: number } {
  let wd = "";
  let hour = 0;
  for (const p of MADRID.formatToParts(new Date(ts))) {
    if (p.type === "weekday") wd = p.value;
    else if (p.type === "hour") hour = Number(p.value) % 24;
  }
  return { dayType: wd === "Sat" ? "saturday" : wd === "Sun" ? "sunday" : "weekday", hour };
}

/** «Lo habitual» (perfil fijo) de una capa de actividad en un instante. */
export function expectedActivity(layer: ActivityLayer, ts: number): number {
  const { dayType, hour } = localSlot(ts);
  return FIXED_PROFILE.peak[layer] * (FIXED_PROFILE.shape[layer][dayType][hour] ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------------------------

/** Agregados por tramo (`idx` = nº de tramo desde `from`); solo existen filas de tramos con datos. */
export interface PulseAggregates {
  /** Entidades distintas en movimiento por capa móvil y tramo (fila presente = la capa tiene datos). */
  mobile: { layer: "bus" | "ship" | "plane"; idx: number; moving: number }[];
  /** Suma de |Δ bicis| entre lecturas consecutivas de cada estación, por tramo. */
  bike: { idx: number; rotation: number }[];
  /** Media del valor de cada métrica ambiental por tramo. */
  obs: { layer: "weather" | "air" | "sea"; metric: string; idx: number; avg: number }[];
}

export const emptyAggregates = (): PulseAggregates => ({ mobile: [], bike: [], obs: [] });

export interface PulseInput {
  from: number;
  to: number;
  stepMs: number;
  weights: PulseWeights;
  now: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;

/** Actividad relativa de una capa ambiental: 1 + 0,25 · media de desviaciones (acotadas a ±2) → [0,5; 1,5]. */
export function environmentRatio(
  layer: "weather" | "air" | "sea",
  metrics: readonly { metric: string; avg: number }[],
): number | undefined {
  const known = OBSERVATION_NORMALS[layer];
  const devs: number[] = [];
  for (const m of metrics) {
    const n = known[m.metric];
    if (n && Number.isFinite(m.avg))
      devs.push(clamp((m.avg - n.normal) / n.scale, -MAX_DEVIATION, MAX_DEVIATION));
  }
  if (devs.length === 0) return undefined;
  return 1 + (OBSERVATION_GAIN * devs.reduce((a, b) => a + b, 0)) / devs.length;
}

/**
 * Serie del índice para `[from, to)`: un punto por tramo `[from + k·step, …)` con datos.
 *
 * - Razón de capa `r` (1 = lo habitual; acotada a `[0, 3]`):
 *   - `bus|ship|plane`: `(en movimiento + 1) / (peak × forma(día-tipo, hora) + 1)`.
 *   - `bike`: `(rotación × 5 min/paso + 1) / (peak × forma + 1)`.
 *   - `weather|air|sea`: `1 + 0,25 · desviación media` (ver `environmentRatio`).
 * - Una capa móvil o de bicis sin ninguna lectura en TODA la ventana se omite (sin datos ≠ actividad 0);
 *   con datos en la ventana pero no en el tramo cuenta como 0 en movimiento.
 * - `value = clamp(50 · Σ wᵢ·rᵢ / Σ wᵢ, 0, 100)` sobre las capas presentes, con 1 decimal: 50 = lo habitual,
 *   100 = el doble o más. Capas con peso 0 no se calculan.
 */
export function computePulse(input: PulseInput, agg: PulseAggregates): Pulse {
  const { from, to, stepMs, weights, now } = input;
  const steps = Math.ceil((to - from) / stepMs);

  const mobile = new Map<string, number>(); // "layer:idx" → en movimiento
  const mobileAlive = new Set<string>();
  for (const r of agg.mobile) {
    mobile.set(`${r.layer}:${r.idx}`, r.moving);
    mobileAlive.add(r.layer);
  }
  const bike = new Map(agg.bike.map((r) => [r.idx, r.rotation]));
  const obs = new Map<string, { metric: string; avg: number }[]>(); // "layer:idx"
  for (const r of agg.obs) {
    const k = `${r.layer}:${r.idx}`;
    const list = obs.get(k) ?? [];
    list.push({ metric: r.metric, avg: r.avg });
    obs.set(k, list);
  }

  const points: PulsePoint[] = [];
  for (let i = 0; i < steps; i++) {
    const ts = from + i * stepMs;
    if (ts >= now) break;
    const ratios: Partial<Record<PulseLayer, number>> = {};

    for (const layer of ["bus", "ship", "plane"] as const) {
      if (weights[layer] <= 0 || !mobileAlive.has(layer)) continue;
      const moving = mobile.get(`${layer}:${i}`) ?? 0;
      ratios[layer] = (moving + SMOOTHING) / (expectedActivity(layer, ts) + SMOOTHING);
    }

    if (weights.bike > 0 && agg.bike.length > 0) {
      // Tramo en curso o recortado por `to`: se extrapola la rotación observada al tramo completo.
      const elapsed = Math.min(ts + stepMs, now, to) - ts;
      if (elapsed >= Math.min(stepMs, MIN_PARTIAL_MS)) {
        const per5 = ((bike.get(i) ?? 0) * BIKE_REF_STEP_MS) / elapsed;
        ratios.bike = (per5 + SMOOTHING) / (expectedActivity("bike", ts) + SMOOTHING);
      }
    }

    for (const layer of ["weather", "air", "sea"] as const) {
      if (weights[layer] <= 0) continue;
      const r = environmentRatio(layer, obs.get(`${layer}:${i}`) ?? []);
      if (r !== undefined) ratios[layer] = r;
    }

    let sum = 0;
    let wsum = 0;
    const layers: PulsePoint["layers"] = {};
    for (const layer of PULSE_LAYERS) {
      const r = ratios[layer];
      if (r === undefined) continue;
      const c = clamp(r, 0, PULSE_LAYER_MAX);
      sum += weights[layer] * c;
      wsum += weights[layer];
      layers[layer] = round(c, 2);
    }
    if (wsum === 0) continue;
    points.push({ ts, value: round(clamp((50 * sum) / wsum, 0, 100), 1), layers });
  }

  return { v: PULSE_VERSION, from, to, stepMs, points, profile: "fixed" };
}

// ---------------------------------------------------------------------------------------------
// Parámetros, caché HTTP
// ---------------------------------------------------------------------------------------------

export interface PulseParams {
  from: number;
  to: number;
  stepMs: number;
}
export type ParsedPulse = { ok: true; params: PulseParams } | { ok: false; error: string };

/**
 * Valida `?from=&to=[&step=]` (todo en ms, enteros decimales). Ventana (0, 24 h], `from` ≤ ahora y no más
 * antiguo que `maxAgeDays`; `step` múltiplo de 1 min entre 1 min y 1 h (por defecto 5 min).
 */
export function parsePulseParams(
  query: Record<string, unknown>,
  now: number,
  maxAgeDays: number,
): ParsedPulse {
  const from = parseMs(query["from"], "from");
  if (typeof from === "string") return { ok: false, error: from };
  const to = parseMs(query["to"], "to");
  if (typeof to === "string") return { ok: false, error: to };
  if (to <= from) return { ok: false, error: "to debe ser mayor que from" };
  if (to - from > PULSE_MAX_WINDOW_MS)
    return { ok: false, error: `la ventana máxima es de ${PULSE_MAX_WINDOW_MS / 3_600_000} h` };
  if (from > now) return { ok: false, error: "from está en el futuro" };
  if (from < now - maxAgeDays * DAY_MS)
    return { ok: false, error: `from es anterior a los ${maxAgeDays} días de histórico` };
  let stepMs = PULSE_DEFAULT_STEP_MS;
  const rawStep = query["step"];
  if (rawStep !== undefined) {
    if (typeof rawStep !== "string" || !/^\d{1,8}$/.test(rawStep))
      return { ok: false, error: "step debe ser un entero en milisegundos" };
    stepMs = Number(rawStep);
    if (stepMs < PULSE_MIN_STEP_MS || stepMs > PULSE_MAX_STEP_MS || stepMs % 60_000 !== 0)
      return {
        ok: false,
        error: `step debe ser múltiplo de 1 min entre ${PULSE_MIN_STEP_MS / 60_000} min y ${PULSE_MAX_STEP_MS / 60_000} min`,
      };
  }
  return { ok: true, params: { from, to, stepMs } };
}

/**
 * Caché por ventana: incluye «ahora» → 30 s; reciente (< 10 min) o sin puntos → 1 min; pasada y asentada → 1 h
 * (no `immutable`: el perfil fijo se sustituirá por el aprendido y las vistas de 1 min pueden retocar valores).
 */
export function pulseCacheControl(o: { to: number; now: number; empty: boolean }): string {
  if (o.to > o.now) return "public, max-age=30";
  if (o.empty || o.to > o.now - REPLAY_SETTLE_MS) return "public, max-age=60";
  return "public, max-age=3600";
}

/** ETag fuerte: hash del cuerpo JSON (mismos datos = mismos bytes). */
export const pulseEtag = (body: string): string =>
  `"${createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;

/** Capas de la API a leer de la BD según los pesos activos. */
export const activePulseLayers = (w: PulseWeights): PulseLayer[] =>
  PULSE_LAYERS.filter((l) => w[l] > 0);
