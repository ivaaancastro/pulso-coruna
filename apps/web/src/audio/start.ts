import { createConductor } from "./conductor";
import type { AudioContextLike } from "./context";
import { createEngine, type AudioEngine } from "./engine";
import { createRng } from "./grid";
import { readSoundState, type ItemsReader } from "./state";

export interface StartAudioOptions {
  /** Contexto ya creado dentro del gesto del usuario (ver `createUserContext`). */
  ctx: AudioContextLike;
  /** Lo que ven las capas: el almacén en vivo o el de Reproducir (`SwitchableStore`). */
  store: ItemsReader;
  /** `false`: Reproducir en pausa; solo suenan las capas continuas. */
  transientsEnabled?: () => boolean;
  doc?: VisibilitySource;
  seed?: number;
}

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface AudioHandle {
  readonly engine: AudioEngine;
  /** Apaga con fundido, libera los nodos y cierra el contexto. */
  stop(): Promise<void>;
}

/**
 * Chunk diferido de «Escuchar» (M7.1): solo se descarga al activarlo. Conecta el almacén vigente
 * con el motor y suspende el contexto con la pestaña oculta.
 */
export function startAudio(opts: StartAudioOptions): AudioHandle {
  const doc = opts.doc ?? document;
  const engine = createEngine(opts.ctx);
  const conductor = createConductor({
    engine,
    readState: () => readSoundState(opts.store),
    rng: createRng(opts.seed ?? 0x9e3779b9),
    ...(opts.transientsEnabled ? { transientsEnabled: opts.transientsEnabled } : {}),
  });

  const onVisibility = (): void => {
    if (doc.hidden) void engine.suspend().catch(() => undefined);
    else void engine.resume().catch(() => undefined);
  };
  doc.addEventListener("visibilitychange", onVisibility);
  try {
    if (doc.hidden) onVisibility();
    conductor.start();
  } catch (error) {
    // Un fallo en el primer ciclo no deja el listener ni los nodos vivos (el motor ya existe).
    doc.removeEventListener("visibilitychange", onVisibility);
    conductor.stop();
    void engine.dispose().catch(() => undefined);
    throw error;
  }

  let stopped: Promise<void> | null = null;
  const handle: AudioHandle = {
    engine,
    stop() {
      stopped ??= (async () => {
        doc.removeEventListener("visibilitychange", onVisibility);
        conductor.stop();
        await engine.dispose();
        if (import.meta.env.DEV)
          delete (window as unknown as { __pulsoAudio?: AudioHandle }).__pulsoAudio;
      })();
      return stopped;
    },
  };
  if (import.meta.env.DEV)
    (window as unknown as { __pulsoAudio?: AudioHandle }).__pulsoAudio = handle;
  return handle;
}
