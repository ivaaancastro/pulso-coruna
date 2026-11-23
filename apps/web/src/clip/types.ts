import type { Map as MapLibreMap } from "maplibre-gl";
import type { Locale, Translate } from "../i18n";

/** Duración del clip y formato de salida (M8.5, `docs/specs/M8.5-clip-og.md`). */
export const CLIP_DURATION_MS = 15_000;
export const CLIP_WIDTH = 1080;
export const CLIP_HEIGHT = 1920;
export const CLIP_FPS = 30;

/** Lo que el botón pasa al motor al empezar (el mapa y deck.gl existen solo cuando ya hay primer fotograma). */
export interface ClipContext {
  map: Pick<MapLibreMap, "getCanvas" | "on" | "off" | "triggerRepaint">;
  deck: { canvas(): HTMLCanvasElement | null; onFrame(cb: () => void): () => void } | null;
  t: Translate;
  locale: Locale;
  now(): number;
  index(): { value: number | null; fixed: boolean };
}

export type ClipPhase = "starting" | "recording" | "finishing";
export interface ClipProgress {
  phase: ClipPhase;
  elapsedMs: number;
  durationMs: number;
}

export type ClipOutcome =
  { kind: "done"; fileName: string } | { kind: "cancelled"; reason: "user" | "hidden" };

export interface ClipSession {
  /** Resuelve con el resultado; rechaza con `Error("unsupported" | "recorder" | "stalled")`. */
  done: Promise<ClipOutcome>;
  cancel(): void;
}
