import { z } from "zod";
import { LayerIdSchema, TimestampSchema } from "./layers.js";

/** Versión del mensaje del índice Pulso (JSON). Cambios incompatibles → v2. */
export const PULSE_VERSION = 1 as const;

/** Ventana máxima de una petición (24 h), paso por defecto y límites del paso (ms). */
export const PULSE_MAX_WINDOW_MS = 24 * 3_600_000;
export const PULSE_DEFAULT_STEP_MS = 5 * 60_000;
export const PULSE_MIN_STEP_MS = 60_000;
export const PULSE_MAX_STEP_MS = 3_600_000;
/** Tope de la actividad relativa de una capa (1 = lo habitual; 0 = nada; 3 = el triple o más). */
export const PULSE_LAYER_MAX = 3;

/**
 * `fixed`: perfil de «lo habitual» como tabla constante (estimada, no medida).
 * `learned`: perfil aprendido de ≥ 1 mes de histórico propio (futuro; ADR-0026). La UI debe etiquetar `fixed`.
 */
export const PulseProfileSchema = z.enum(["fixed", "learned"]);
export type PulseProfile = z.infer<typeof PulseProfileSchema>;

const hasAtMostOneDecimal = (v: number): boolean => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;

export const PulsePointSchema = z.strictObject({
  /** Inicio del tramo (epoch ms UTC): `from + k·stepMs`. */
  ts: TimestampSchema,
  /** Índice 0–100 con 1 decimal: ~50 = normal para ese día-tipo y hora, 100 = muy por encima. */
  value: z.number().min(0).max(100).refine(hasAtMostOneDecimal, "como máximo 1 decimal"),
  /** Actividad relativa por capa (1 = lo habitual). Solo capas con datos en el tramo. */
  layers: z.partialRecord(LayerIdSchema, z.number().min(0).max(PULSE_LAYER_MAX)),
});
export type PulsePoint = z.infer<typeof PulsePointSchema>;

/** Serie del índice Pulso para `[from, to)` con un punto por tramo de `stepMs` que tenga datos. */
export const PulseSchema = z
  .strictObject({
    v: z.literal(PULSE_VERSION),
    from: TimestampSchema,
    to: TimestampSchema,
    stepMs: z.int().min(PULSE_MIN_STEP_MS).max(PULSE_MAX_STEP_MS),
    points: z.array(PulsePointSchema),
    profile: PulseProfileSchema,
  })
  .superRefine((m, ctx) => {
    const span = m.to - m.from;
    if (span <= 0) ctx.addIssue({ code: "custom", path: ["to"], message: "to debe ser > from" });
    if (span > PULSE_MAX_WINDOW_MS)
      ctx.addIssue({ code: "custom", path: ["to"], message: "la ventana excede 24 h" });
    let prev = -Infinity;
    m.points.forEach((p, i) => {
      const off = p.ts - m.from;
      if (off < 0 || p.ts >= m.to || off % m.stepMs !== 0)
        ctx.addIssue({
          code: "custom",
          path: ["points", i, "ts"],
          message: "ts debe ser from + k·stepMs dentro de la ventana",
        });
      if (p.ts <= prev)
        ctx.addIssue({
          code: "custom",
          path: ["points", i, "ts"],
          message: "ts debe ser estrictamente creciente",
        });
      prev = p.ts;
    });
  });
export type Pulse = z.infer<typeof PulseSchema>;
