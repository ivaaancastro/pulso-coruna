import type { LiveLayerDefinition } from "../layer-registry";
import { FpsMonitor, QUALITY_LEVELS, type MonitorOptions, type QualityLevel } from "./monitor";

/**
 * Engancha el monitor de fps a las capas registradas (M4.7). No conoce capas concretas: cada una
 * implementa `setQualityLevel?(level)` en su definición (ver `layer-registry.ts`).
 */
export interface AutoQualityOptions {
  definitions: readonly LiveLayerDefinition[];
  /** Planificador de fotogramas (rAF por defecto); recibe la marca del fotograma, en ms. */
  raf?: (cb: (t: number) => void) => number;
  cancel?: (id: number) => void;
  motion?: { matches: boolean; addEventListener(type: "change", cb: () => void): void };
  /** `document` (visibilidad); inyectable para tests. */
  doc?: Pick<Document, "addEventListener" | "removeEventListener" | "hidden">;
  /** Solo dev: `?perf=low|medium|high` fuerza un nivel y desactiva la degradación automática. */
  forced?: QualityLevel | null;
  monitor?: MonitorOptions;
  /** Depuración: se llama en cada cambio de nivel. */
  onChange?(level: QualityLevel, fps: number): void;
}

export interface AutoQuality {
  readonly level: QualityLevel;
  readonly fps: number;
  /** Fuerza un nivel y detiene la degradación automática (depuración). */
  force(level: QualityLevel): void;
  destroy(): void;
}

export function parsePerfOverride(search: string): QualityLevel | null {
  const v = new URLSearchParams(search).get("perf");
  return (QUALITY_LEVELS as readonly string[]).includes(v ?? "") ? (v as QualityLevel) : null;
}

export function startAutoQuality(opts: AutoQualityOptions): AutoQuality {
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const cancel = opts.cancel ?? ((id) => cancelAnimationFrame(id));
  const doc = opts.doc ?? document;
  const monitor = new FpsMonitor(opts.monitor);
  let manual = false;
  let timer = 0;
  let alive = true;

  const apply = (level: QualityLevel): void => {
    for (const d of opts.definitions) {
      try {
        d.setQualityLevel?.(level);
      } catch (error) {
        console.error(`[live] la capa ${d.id} falló al cambiar la calidad`, error);
      }
    }
    opts.onChange?.(level, monitor.fps);
  };
  // Con reduced-motion ya no hay animación continua que degradar; oculta, rAF se detiene.
  const sync = (): void => {
    monitor.setActive(!manual && !doc.hidden && !opts.motion?.matches);
  };
  const tick = (t: number): void => {
    if (!alive) return;
    const next = monitor.frame(t);
    if (next) apply(next);
    timer = raf(tick);
  };

  if (opts.forced) {
    manual = true;
    monitor.force(opts.forced);
  }
  apply(monitor.level);
  sync();
  doc.addEventListener("visibilitychange", sync);
  opts.motion?.addEventListener("change", sync);
  timer = raf(tick);

  return {
    get level() {
      return monitor.level;
    },
    get fps() {
      return monitor.fps;
    },
    force(level) {
      manual = true;
      monitor.force(level);
      sync();
      apply(level);
    },
    destroy() {
      alive = false;
      cancel(timer);
      doc.removeEventListener("visibilitychange", sync);
    },
  };
}
