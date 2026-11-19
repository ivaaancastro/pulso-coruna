/**
 * Calidad y longitud de las estelas de bus. Módulo sin dependencias (ni deck.gl ni DOM): la
 * degradación automática (M4.7) y los ajustes lo importan directamente.
 *
 * ```ts
 * import { busTrailConfig } from "./layers/bus/trail-config";
 * busTrailConfig.degrade();               // high → medium → low (devuelve false si ya estaba en low)
 * busTrailConfig.setQuality("high");
 * busTrailConfig.setLengthMs(8000);       // longitud propia; null vuelve a la de la calidad
 * ```
 *
 * La capa lee `busTrailConfig.settings` en cada fotograma, así que los cambios se aplican en el
 * siguiente. Con `prefers-reduced-motion` la capa no dibuja estelas, sea cual sea la calidad.
 */
export type TrailQuality = "high" | "medium" | "low";

export interface TrailSettings {
  /** Cuánto dura la estela (se desvanece linealmente hasta cero), ms. 0 = sin estelas. */
  lengthMs: number;
  /** Intervalo mínimo entre vértices guardados por bus, ms. */
  sampleMs: number;
  /** Desplazamiento mínimo para guardar un vértice, m (un bus parado no añade puntos). */
  minStepM: number;
}

/** `direccion.md`: estela de bus de 20–30 s en calidad plena. */
export const TRAIL_PRESETS: Readonly<Record<TrailQuality, TrailSettings>> = {
  high: { lengthMs: 25_000, sampleMs: 300, minStepM: 2 },
  medium: { lengthMs: 12_000, sampleMs: 500, minStepM: 3 },
  low: { lengthMs: 5_000, sampleMs: 1000, minStepM: 5 },
};

export const MAX_TRAIL_MS = 60_000;

const ORDER: readonly TrailQuality[] = ["high", "medium", "low"];

export class TrailConfig {
  private current: TrailQuality;
  private override: number | null = null;

  constructor(quality: TrailQuality = "high") {
    this.current = quality;
  }

  get quality(): TrailQuality {
    return this.current;
  }

  /** Longitud propia vigente (`null`: la de la calidad). */
  get lengthOverrideMs(): number | null {
    return this.override;
  }

  get settings(): TrailSettings {
    const preset = TRAIL_PRESETS[this.current];
    return this.override === null ? preset : { ...preset, lengthMs: this.override };
  }

  /** Cambia la calidad; quita la longitud propia para que mande el preset. */
  setQuality(quality: TrailQuality): void {
    this.current = quality;
    this.override = null;
  }

  /** Longitud propia en ms (se acota a [0, 60 s]); `null` vuelve a la de la calidad. */
  setLengthMs(ms: number | null): void {
    this.override =
      ms === null || !Number.isFinite(ms) ? null : Math.min(MAX_TRAIL_MS, Math.max(0, ms));
  }

  /** Baja un nivel de calidad. `false` si ya estaba en el más bajo. */
  degrade(): boolean {
    const i = ORDER.indexOf(this.current);
    if (i >= ORDER.length - 1) return false;
    this.setQuality(ORDER[i + 1] as TrailQuality);
    return true;
  }

  /** Sube un nivel de calidad. `false` si ya estaba en el más alto. */
  improve(): boolean {
    const i = ORDER.indexOf(this.current);
    if (i <= 0) return false;
    this.setQuality(ORDER[i - 1] as TrailQuality);
    return true;
  }
}

/** Instancia única de la capa bus. */
export const busTrailConfig = new TrailConfig();
