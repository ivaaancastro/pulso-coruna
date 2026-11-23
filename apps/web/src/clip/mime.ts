/** mp4 primero (se reproduce y se comparte en todas partes y lleva duración); WebM de reserva. */
export const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm",
] as const;

/** Primer `mimeType` que acepta el navegador; `null` si ninguno. */
export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  for (const type of MIME_CANDIDATES) {
    try {
      if (isSupported(type)) return type;
    } catch {
      // un navegador que lanza con un tipo se trata como «no soportado»
    }
  }
  return null;
}

/** Extensión de archivo para un `mimeType` de MediaRecorder. */
export const extensionOf = (mime: string): string =>
  mime.startsWith("video/mp4") ? "mp4" : "webm";

/** `pulso-coruna-aaaammddThhmmZ.mp4`, en UTC. */
export function clipFileName(epochMs: number, mime: string): string {
  const stamp = new Date(epochMs).toISOString().slice(0, 16).replace(/[-:]/g, "");
  return `pulso-coruna-${stamp}Z.${extensionOf(mime)}`;
}
