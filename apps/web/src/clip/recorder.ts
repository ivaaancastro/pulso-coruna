import { pickMimeType } from "./mime";
import { CLIP_DURATION_MS, type ClipProgress } from "./types";

/** Lo mínimo de `MediaRecorder` que se usa (así se simula en tests). */
export interface RecorderLike {
  start(timesliceMs?: number): void;
  stop(): void;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
}
export interface RecorderCtor {
  new (
    stream: MediaStream,
    options: { mimeType: string; videoBitsPerSecond: number },
  ): RecorderLike;
  isTypeSupported(type: string): boolean;
}
export interface RecorderOptions {
  stream: MediaStream;
  Recorder: RecorderCtor;
  durationMs?: number;
  onProgress?: (p: ClipProgress) => void;
}

export type RecorderResult = { kind: "done"; blob: Blob; mimeType: string } | { kind: "cancelled" };

/** Espera máxima a que `MediaRecorder` emita `stop` tras pedírselo. */
export const STOP_GRACE_MS = 3_000;
const TICK_MS = 250;

/**
 * Temporizador y estados de la grabación (M8.5): `recording` hasta `durationMs`, `finishing` mientras el
 * navegador vuelca el archivo, y `done` / `cancelled`; error si no hay `mimeType` (`unsupported`), el
 * grabador falla (`recorder`) o no cierra (`stalled`). Cancelar descarta lo grabado.
 */
export function createClipRecorder(o: RecorderOptions): {
  start(): Promise<RecorderResult>;
  cancel(): void;
} {
  const durationMs = o.durationMs ?? CLIP_DURATION_MS;
  let cancelFn: () => void = () => undefined;

  const start = (): Promise<RecorderResult> =>
    new Promise((resolve, reject) => {
      const mimeType = pickMimeType((t) => o.Recorder.isTypeSupported(t));
      if (!mimeType) return reject(new Error("unsupported"));
      let rec: RecorderLike;
      try {
        rec = new o.Recorder(o.stream, {
          mimeType,
          videoBitsPerSecond: 5_000_000,
        });
      } catch {
        return reject(new Error("recorder"));
      }
      const chunks: Blob[] = [];
      const t0 = Date.now();
      let stopping = false;
      let cancelled = false;
      let settled = false;
      const h: Record<"ticker" | "limit" | "grace", ReturnType<typeof setTimeout> | undefined> = {
        ticker: undefined,
        limit: undefined,
        grace: undefined,
      };
      const progress = (phase: ClipProgress["phase"]): void =>
        o.onProgress?.({
          phase,
          elapsedMs: Math.min(durationMs, Date.now() - t0),
          durationMs,
        });
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearInterval(h.ticker);
        clearTimeout(h.limit);
        clearTimeout(h.grace);
        fn();
      };
      const stop = (): void => {
        if (stopping) return;
        stopping = true;
        clearInterval(h.ticker);
        clearTimeout(h.limit);
        progress("finishing");
        h.grace = setTimeout(() => settle(() => reject(new Error("stalled"))), STOP_GRACE_MS);
        try {
          rec.stop();
        } catch {
          settle(() => reject(new Error("recorder")));
        }
      };
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onerror = () => settle(() => reject(new Error("recorder")));
      rec.onstop = () =>
        settle(() =>
          cancelled || chunks.length === 0
            ? resolve({ kind: "cancelled" })
            : resolve({
                kind: "done",
                blob: new Blob(chunks, { type: mimeType.split(";")[0] ?? mimeType }),
                mimeType,
              }),
        );
      cancelFn = () => {
        if (settled) return;
        cancelled = true;
        stop();
      };
      try {
        rec.start(1_000);
      } catch {
        return reject(new Error("recorder"));
      }
      progress("recording");
      h.ticker = setInterval(() => progress("recording"), TICK_MS);
      h.limit = setTimeout(stop, durationMs);
    });

  return { start, cancel: () => cancelFn() };
}
