import type { Layer } from "@deck.gl/core";
import type { LiveChange, LiveStoreReader } from "./live-store";
import type { LiveLayerDefinition } from "./layer-registry";
import { stateOpacity, type SourceState } from "./source-status";

export interface PipelineOptions {
  definitions: readonly LiveLayerDefinition[];
  store: LiveStoreReader;
  now: () => number;
  reducedMotion: () => boolean;
  onError?: (id: string, error: unknown) => void;
  /** Una capa pidió recalcularse (`ctx.invalidate`): hay que planificar un fotograma. */
  onInvalidate?: () => void;
  /**
   * Estado de la fuente de una definición (M4.6). El pipeline atenúa sus capas según el estado y,
   * en `nodata`, las hace no seleccionables: las capas no implementan nada de esto.
   */
  status?: (definition: LiveLayerDefinition) => SourceState;
  /** `--pulso-layer-muted-opacity` (por defecto 0,35). */
  mutedOpacity?: number;
  /** Duración del fundido de opacidad, ms (`--pulso-dur-slow`); se ignora con reduced-motion. */
  fadeMs?: number;
  /** Reloj monotónico del fundido (`performance.now`). */
  clock?: () => number;
}

/** Fundido de opacidad de una definición hacia el factor de su estado. */
interface Fade {
  state: SourceState;
  from: number;
  to: number;
  t0: number;
  factor: number;
}

interface Styled {
  source: Layer[];
  factor: number;
  pickable: boolean;
  out: Layer[];
}

const easeOut = (k: number): number => 1 - (1 - k) ** 3;

/**
 * Decide qué capas deck.gl hay que recrear: solo las definiciones cuyas fuentes cambiaron (o las
 * animadas). Un error en una capa no tumba a las demás. Sin dependencias de WebGL: se prueba en Node.
 */
export class LayerPipeline {
  private readonly cache = new Map<string, Layer[]>();
  private readonly dirty = new Set<string>();
  private readonly fades = new Map<string, Fade>();
  private readonly styled = new Map<string, Styled>();
  private readonly hooks: { d: LiveLayerDefinition; state: SourceState }[] = [];
  private touched = false;
  private fading = false;

  constructor(private readonly opts: PipelineOptions) {
    for (const d of opts.definitions) this.dirty.add(d.id);
  }

  /** Marca como sucias las definiciones afectadas. Devuelve si alguna lo está. */
  notify(change: LiveChange): boolean {
    for (const d of this.opts.definitions) {
      const affected =
        change.kind === "connection" ||
        change.kind === "reset" ||
        (change.kind === "items" && d.sources.includes(change.layer)) ||
        (change.kind === "frames" && change.layers.some((l) => d.sources.includes(l)));
      if (affected) this.dirty.add(d.id);
    }
    return this.dirty.size > 0;
  }

  /** El estado de alguna fuente cambió: hay que volver a aplicar la atenuación (sin recrear capas). */
  touch(): void {
    this.touched = true;
  }

  /** ¿Hay trabajo pendiente, alguna capa animada o un fundido en curso? */
  get pending(): boolean {
    return (
      this.dirty.size > 0 ||
      this.touched ||
      this.fading ||
      this.opts.definitions.some((d) => d.animated)
    );
  }

  /** ¿Algún fundido de opacidad sigue en curso? (hacen falta más fotogramas aunque no haya datos) */
  get isFading(): boolean {
    return this.fading;
  }

  /** Recalcula lo sucio y devuelve todas las capas, en orden de registro. */
  collect(): Layer[] {
    const base = {
      store: this.opts.store,
      now: this.opts.now(),
      reducedMotion: this.opts.reducedMotion(),
    };
    const out: Layer[] = [];
    this.fading = false;
    for (const d of this.opts.definitions) {
      if (this.dirty.has(d.id) || d.animated || !this.cache.has(d.id)) {
        try {
          const invalidate = (): void => {
            this.dirty.add(d.id);
            this.opts.onInvalidate?.();
          };
          this.cache.set(d.id, d.createLayers({ ...base, invalidate }));
        } catch (error) {
          this.cache.set(d.id, this.cache.get(d.id) ?? []);
          this.opts.onError?.(d.id, error);
        }
      }
      out.push(...this.restyle(d, this.cache.get(d.id) ?? []));
    }
    this.dirty.clear();
    this.touched = false;
    // Tras limpiar: un hook puede invalidar su capa (cerrar una tarjeta) y eso no debe perderse.
    for (const { d, state } of this.hooks.splice(0)) {
      try {
        d.onSourceState?.(state);
      } catch (error) {
        this.opts.onError?.(d.id, error);
      }
    }
    return out;
  }

  /** Aplica la atenuación del estado de la fuente a las capas de una definición. */
  private restyle(d: LiveLayerDefinition, layers: Layer[]): Layer[] {
    if (!this.opts.status) return layers;
    const clock = this.opts.clock ?? (() => performance.now());
    const state = this.safeState(d);
    const target = stateOpacity(state, this.opts.mutedOpacity ?? 0.35);
    const t = clock();
    let fade = this.fades.get(d.id);
    if (!fade) {
      fade = { state, from: target, to: target, t0: t, factor: target };
      this.fades.set(d.id, fade);
    } else if (fade.state !== state) {
      fade = { state, from: fade.factor, to: target, t0: t, factor: fade.factor };
      this.fades.set(d.id, fade);
      if (d.onSourceState) this.hooks.push({ d, state });
    }
    const dur = this.opts.reducedMotion() ? 0 : (this.opts.fadeMs ?? 0);
    const k = dur <= 0 || fade.from === fade.to ? 1 : Math.min(1, (t - fade.t0) / dur);
    fade.factor = fade.from + (fade.to - fade.from) * easeOut(k);
    if (k >= 1) fade.factor = fade.to;
    else this.fading = true;

    const pickable = state !== "nodata";
    if (fade.factor >= 1 && pickable) return layers;
    const prev = this.styled.get(d.id);
    if (
      prev &&
      prev.source === layers &&
      prev.factor === fade.factor &&
      prev.pickable === pickable
    ) {
      return prev.out;
    }
    const out = layers.map((layer) => {
      if (typeof layer.clone !== "function") return layer;
      const props: { opacity: number; pickable?: false } = {
        opacity: ((layer.props as { opacity?: number }).opacity ?? 1) * fade.factor,
      };
      if (!pickable) props.pickable = false;
      return layer.clone(props);
    });
    this.styled.set(d.id, { source: layers, factor: fade.factor, pickable, out });
    return out;
  }

  private safeState(d: LiveLayerDefinition): SourceState {
    try {
      return this.opts.status?.(d) ?? "live";
    } catch (error) {
      this.opts.onError?.(d.id, error);
      return "live";
    }
  }
}
