import { startComposer } from "./compose";
import { clipFileName } from "./mime";
import { createClipRecorder, type RecorderCtor } from "./recorder";
import {
  CLIP_FPS,
  type ClipContext,
  type ClipOutcome,
  type ClipProgress,
  type ClipSession,
} from "./types";

/** Descarga local del archivo (sin red): `<a download>` sobre una URL de objeto. */
function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Chunk diferido del clip (M8.5): compone, graba 15 s con `captureStream` + `MediaRecorder` y descarga.
 * Si la pestaña pasa a segundo plano se cancela (los temporizadores se estrangulan y saldría congelado).
 */
export function startClip(ctx: ClipContext, onProgress: (p: ClipProgress) => void): ClipSession {
  let cancel: () => void = () => undefined;
  let hidden = false;
  let asked = false;
  const onHide = (): void => {
    if (document.visibilityState === "hidden") {
      hidden = true;
      cancel();
    }
  };
  const stopped = (): ClipOutcome => ({ kind: "cancelled", reason: hidden ? "hidden" : "user" });
  const done = (async (): Promise<ClipOutcome> => {
    onProgress({ phase: "starting", elapsedMs: 0, durationMs: 0 });
    const composer = startComposer(ctx);
    document.addEventListener("visibilitychange", onHide);
    try {
      await composer.ready();
      if (asked || hidden) return stopped();
      const recorder = createClipRecorder({
        stream: composer.canvas.captureStream(CLIP_FPS),
        Recorder: MediaRecorder as unknown as RecorderCtor,
        onProgress,
      });
      cancel = recorder.cancel;
      const result = await recorder.start();
      if (result.kind === "cancelled") return stopped();
      const fileName = clipFileName(ctx.now(), result.mimeType);
      download(result.blob, fileName);
      return { kind: "done", fileName };
    } finally {
      document.removeEventListener("visibilitychange", onHide);
      composer.destroy();
    }
  })();
  return {
    done,
    cancel: () => {
      asked = true;
      cancel();
    },
  };
}
