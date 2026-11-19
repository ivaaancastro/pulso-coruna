import { z } from "zod";
import { LayerIdSchema, OBSERVATION_LAYER_IDS, TimestampSchema, type LayerId } from "./layers.js";

/** Versión del mensaje de replay (MessagePack). Cambios incompatibles → v2. */
export const REPLAY_VERSION = 1 as const;

/** Duración máxima de una ventana, y tamaño del bloque alineable para caché (5 min). */
export const REPLAY_WINDOW_MS = 5 * 60_000;

/** lon/lat viajan como enteros en unidades de 1e-5° (~1,1 m): `lon = valor / REPLAY_COORD_SCALE`. */
export const REPLAY_COORD_SCALE = 100_000;
/** `speed` viaja como entero en dm/s: `m/s = valor / REPLAY_SPEED_SCALE`. `heading`: grados enteros 0–360. */
export const REPLAY_SPEED_SCALE = 10;

export const toReplayCoord = (deg: number): number => Math.round(deg * REPLAY_COORD_SCALE);
export const fromReplayCoord = (q: number): number => q / REPLAY_COORD_SCALE;
export const toReplaySpeed = (ms: number): number => Math.round(ms * REPLAY_SPEED_SCALE);
export const fromReplaySpeed = (q: number): number => q / REPLAY_SPEED_SCALE;

/**
 * `raw`: muestras tal cual se grabaron (≤30 días). `1m`: una muestra por minuto y entidad
 * (el último valor de cada minuto, con `ts` = inicio del minuto), para ventanas más antiguas.
 */
export const ReplayResolutionSchema = z.enum(["raw", "1m"]);
export type ReplayResolution = z.infer<typeof ReplayResolutionSchema>;

/** Instantes: ms desde `from` (entero ≥ 0 dentro de la ventana). */
const offset = z.int().min(0);
/** Estado inicial: último valor conocido ANTES de `from`; `dt` ≤ 0 = ms respecto de `from`. */
const initDt = z.int().max(0);
const coord = z.int();
const metaSchema = z.record(z.string(), z.union([z.string(), z.number()]));

const columns = (n: number, ...cols: (readonly unknown[] | undefined)[]): boolean =>
  cols.every((c) => c === undefined || c.length === n);

const strictlyIncreasing = (a: readonly number[]): boolean =>
  a.every((v, i) => i === 0 || v > (a[i - 1] ?? 0));

const sameLength = { message: "las columnas deben tener la misma longitud que ts" };
const increasing = { message: "ts debe ser estrictamente creciente" };

/** Móvil (bus, barco, avión, tren): trayectoria en columnas paralelas. */
export const ReplayTrackSchema = z
  .strictObject({
    id: z.string().min(1),
    /** Metadatos estables de la entidad (se envían una vez; en `1m` pueden faltar). */
    meta: metaSchema.optional(),
    init: z
      .strictObject({
        dt: initDt,
        lon: coord,
        lat: coord,
        heading: z.int().min(0).max(360).optional(),
        speed: z.int().min(0).optional(),
      })
      .optional(),
    ts: z.array(offset),
    lon: z.array(coord),
    lat: z.array(coord),
    /** Presente solo si alguna muestra tiene rumbo; `null` en las que no. */
    heading: z.array(z.int().min(0).max(360).nullable()).optional(),
    speed: z.array(z.int().min(0).nullable()).optional(),
  })
  .refine((t) => columns(t.ts.length, t.lon, t.lat, t.heading, t.speed), sameLength)
  .refine((t) => strictlyIncreasing(t.ts), increasing);
export type ReplayTrack = z.infer<typeof ReplayTrackSchema>;

/** Estación de bicis: posición fija + serie de ocupación. */
export const ReplayStationSchema = z
  .strictObject({
    id: z.string().min(1),
    lon: coord,
    lat: coord,
    init: z.strictObject({ dt: initDt, bikes: z.int().min(0), docks: z.int().min(0) }).optional(),
    ts: z.array(offset),
    bikes: z.array(z.int().min(0)),
    docks: z.array(z.int().min(0)),
  })
  .refine((s) => columns(s.ts.length, s.bikes, s.docks), sameLength)
  .refine((s) => strictlyIncreasing(s.ts), increasing);
export type ReplayStation = z.infer<typeof ReplayStationSchema>;

/** Observación (meteo, aire, mar): serie por `stationId` + `metric`. */
export const ReplaySeriesSchema = z
  .strictObject({
    stationId: z.string().min(1),
    metric: z.string().min(1),
    unit: z.string(),
    init: z.strictObject({ dt: initDt, value: z.number() }).optional(),
    ts: z.array(offset),
    value: z.array(z.number()),
  })
  .refine((s) => columns(s.ts.length, s.value), sameLength)
  .refine((s) => strictlyIncreasing(s.ts), increasing);
export type ReplaySeries = z.infer<typeof ReplaySeriesSchema>;

export const ReplayLayerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("mobile"), tracks: z.array(ReplayTrackSchema) }),
  z.strictObject({ kind: z.literal("station"), stations: z.array(ReplayStationSchema) }),
  z.strictObject({ kind: z.literal("series"), series: z.array(ReplaySeriesSchema) }),
]);
export type ReplayLayer = z.infer<typeof ReplayLayerSchema>;
export type ReplayLayerKind = ReplayLayer["kind"];

/** Tipo de payload de cada capa: móviles → `mobile`, `bike` → `station`, observaciones → `series`. */
export const replayKindForLayer = (layer: LayerId): ReplayLayerKind => {
  if (layer === "bike") return "station";
  if ((OBSERVATION_LAYER_IDS as readonly string[]).includes(layer)) return "series";
  return "mobile";
};

/**
 * Ventana de histórico `[from, to)` (≤ 5 min) para el modo Reproducir. Se serializa en MessagePack.
 * Todos los instantes de las series son ms desde `from`; el cliente reconstruye `from + ts[i]`.
 */
export const ReplayWindowSchema = z
  .strictObject({
    v: z.literal(REPLAY_VERSION),
    from: TimestampSchema,
    to: TimestampSchema,
    resolution: ReplayResolutionSchema,
    layers: z.partialRecord(LayerIdSchema, ReplayLayerSchema),
  })
  .superRefine((m, ctx) => {
    const span = m.to - m.from;
    if (span <= 0) ctx.addIssue({ code: "custom", path: ["to"], message: "to debe ser > from" });
    if (span > REPLAY_WINDOW_MS)
      ctx.addIssue({ code: "custom", path: ["to"], message: "la ventana excede 5 min" });
    for (const [layer, payload] of Object.entries(m.layers)) {
      const path = ["layers", layer];
      if (payload.kind !== replayKindForLayer(layer as LayerId)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `payload '${payload.kind}' no válido para la capa ${layer}`,
        });
        continue;
      }
      const lists: readonly { ts: readonly number[] }[] =
        payload.kind === "mobile"
          ? payload.tracks
          : payload.kind === "station"
            ? payload.stations
            : payload.series;
      lists.forEach((item, i) => {
        if (item.ts.some((t) => t >= span))
          ctx.addIssue({
            code: "custom",
            path: [...path, i, "ts"],
            message: "ts fuera de la ventana",
          });
      });
    }
  });
export type ReplayWindow = z.infer<typeof ReplayWindowSchema>;
