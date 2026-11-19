import type { LayerItem, StationStatus } from "@pulso/schema";

/**
 * Lógica pura de la capa de bici (sin deck.gl ni DOM): fracción de relleno, estado, geometría y
 * colores de cada anillo. Los colores salen de docs/design/tokens.md (`--pulso-bike`, `--pulso-focus`,
 * `--pulso-layer-muted-opacity`); el mapa base es oscuro de día y de noche, así que no cambian con la fase.
 */
export type BikeState = "out" | "empty" | "full" | "normal";

export type Rgb = readonly [number, number, number];
export type Rgba = [number, number, number, number];

/** `--pulso-bike` #6BE8A4. */
export const BIKE_RGB: Rgb = [107, 232, 164];
/** `--pulso-focus` #F5F1E4. */
export const FOCUS_RGB: Rgb = [245, 241, 228];
/** `--pulso-layer-muted-opacity`. */
export const MUTED_OPACITY = 0.35;

/** Radio del aro, px. */
export const RING_RADIUS = 11;
/** Radio de la zona de toque, px (44 px de diámetro: objetivo táctil mínimo de los tokens). */
export const HIT_RADIUS = 22;
/** Radio del aro de selección, px. */
export const SELECT_RADIUS = RING_RADIUS + 5;
/** `--pulso-dur-slow`. */
export const TRANSITION_MS = 600;

export function isStation(item: LayerItem): item is StationStatus {
  return "bikes" in item && "docks" in item;
}

/** bikes / (bikes + docks); 0 si la estación no tiene ni bicis ni huecos. */
export function fillFraction(s: Pick<StationStatus, "bikes" | "docks">): number {
  const total = s.bikes + s.docks;
  return total > 0 ? s.bikes / total : 0;
}

export function stationState(s: Pick<StationStatus, "bikes" | "docks">): BikeState {
  if (s.bikes + s.docks === 0) return "out";
  if (s.bikes === 0) return "empty";
  if (s.docks === 0) return "full";
  return "normal";
}

/** Grosor del aro en px: la forma distingue vacía (fino) y llena (grueso) sin depender del color. */
export function ringWidth(state: BikeState): number {
  switch (state) {
    case "empty":
    case "out":
      return 1;
    case "full":
      return 4;
    case "normal":
      return 2;
  }
}

/** Opacidad 0–1 de la estación: fuera de servicio, atenuada con el token de capa sin dato. */
export function stationOpacity(state: BikeState): number {
  return state === "out" ? MUTED_OPACITY : 1;
}

/**
 * Radio del disco de relleno en px. El área es proporcional a la fracción (radio ∝ √fracción), de
 * modo que el nivel se lee como superficie. Parte del interior del aro, sin pisar el trazo.
 */
export function fillRadius(fraction: number, width: number, ring = RING_RADIUS): number {
  const inner = Math.max(0, ring - width / 2 - 1);
  const f = Math.min(1, Math.max(0, fraction));
  return inner * Math.sqrt(f);
}

export function withAlpha(rgb: Rgb, opacity: number): Rgba {
  return [rgb[0], rgb[1], rgb[2], Math.round(255 * Math.min(1, Math.max(0, opacity)))];
}

/** Datos ya calculados por estación, listos para los accesores de deck.gl. */
export interface RingDatum {
  id: string;
  position: [number, number];
  state: BikeState;
  width: number;
  fillRadius: number;
  /** Alfa 0–255 del aro y del relleno. */
  alpha: number;
  selected: boolean;
}

export function ringData(
  items: Iterable<LayerItem>,
  selectedId: string | null = null,
): RingDatum[] {
  const out: RingDatum[] = [];
  for (const item of items) {
    if (!isStation(item)) continue;
    const state = stationState(item);
    const width = ringWidth(state);
    out.push({
      id: item.id,
      position: [item.lon, item.lat],
      state,
      width,
      fillRadius: state === "out" ? 0 : fillRadius(fillFraction(item), width),
      alpha: Math.round(255 * stationOpacity(state)),
      selected: item.id === selectedId,
    });
  }
  // Orden estable por id: deck.gl interpola atributos por posición, no por id.
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface TransitionSpec {
  duration: number;
  easing: (t: number) => number;
}

/** ease-out cúbico (en la línea de `--pulso-ease-out`). */
export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Con `prefers-reduced-motion` no hay transición: el cambio es directo. */
export function transitionFor(reducedMotion: boolean): TransitionSpec | undefined {
  return reducedMotion ? undefined : { duration: TRANSITION_MS, easing: easeOut };
}
