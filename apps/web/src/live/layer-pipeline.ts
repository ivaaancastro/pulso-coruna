import type { Layer } from "@deck.gl/core";
import type { LiveChange, LiveStoreReader } from "./live-store";
import type { LiveLayerDefinition } from "./layer-registry";

export interface PipelineOptions {
  definitions: readonly LiveLayerDefinition[];
  store: LiveStoreReader;
  now: () => number;
  reducedMotion: () => boolean;
  onError?: (id: string, error: unknown) => void;
  /** Una capa pidió recalcularse (`ctx.invalidate`): hay que planificar un fotograma. */
  onInvalidate?: () => void;
}

/**
 * Decide qué capas deck.gl hay que recrear: solo las definiciones cuyas fuentes cambiaron (o las
 * animadas). Un error en una capa no tumba a las demás. Sin dependencias de WebGL: se prueba en Node.
 */
export class LayerPipeline {
  private readonly cache = new Map<string, Layer[]>();
  private readonly dirty = new Set<string>();

  constructor(private readonly opts: PipelineOptions) {
    for (const d of opts.definitions) this.dirty.add(d.id);
  }

  /** Marca como sucias las definiciones afectadas. Devuelve si alguna lo está. */
  notify(change: LiveChange): boolean {
    for (const d of this.opts.definitions) {
      const affected =
        change.kind === "connection" ||
        (change.kind === "items" && d.sources.includes(change.layer)) ||
        (change.kind === "frames" && change.layers.some((l) => d.sources.includes(l)));
      if (affected) this.dirty.add(d.id);
    }
    return this.dirty.size > 0;
  }

  /** ¿Hay trabajo pendiente o alguna capa animada? */
  get pending(): boolean {
    return this.dirty.size > 0 || this.opts.definitions.some((d) => d.animated);
  }

  /** Recalcula lo sucio y devuelve todas las capas, en orden de registro. */
  collect(): Layer[] {
    const base = {
      store: this.opts.store,
      now: this.opts.now(),
      reducedMotion: this.opts.reducedMotion(),
    };
    const out: Layer[] = [];
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
      out.push(...(this.cache.get(d.id) ?? []));
    }
    this.dirty.clear();
    return out;
  }
}
