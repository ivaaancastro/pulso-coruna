import type { PlaneInfo } from "./meta";

/**
 * Dead reckoning de un avión entre dos actualizaciones de OpenSky (una cada ~5 min). Puro, sin DOM
 * ni deck.gl. Ver docs/specs/M5.2d-capa-aviones.md.
 */

/** Como mucho se extrapola este tiempo desde `ts`: 5 min de muestreo + margen de ingesta y red. */
export const EXTRAPOLATE_MAX_MS = 8 * 60_000;
/** Hasta aquí la opacidad es plena; después se desvanece linealmente hasta `EXTRAPOLATE_MAX_MS`. */
export const FADE_START_MS = 6 * 60_000;
/** Por debajo de esta velocidad el avión se considera parado (rodaje, ruido del dato), m/s. */
export const MIN_MOVING_SPEED = 2;

const M_PER_DEG_LAT = 111_320;

export interface PlaneEstimate {
  lon: number;
  lat: number;
  /** Edad del dato, ms (≥ 0). */
  ageMs: number;
  /** `true` si la posición se ha desplazado respecto a la recibida. */
  extrapolated: boolean;
  /** 1 plena … 0 oculto (el dato es demasiado viejo para fiarse de la extrapolación). */
  opacity: number;
}

export function canExtrapolate(p: Pick<PlaneInfo, "onGround" | "speed" | "heading">): boolean {
  return (
    !p.onGround && p.heading !== undefined && p.speed !== undefined && p.speed >= MIN_MOVING_SPEED
  );
}

/** Opacidad por edad del dato: 1 hasta `FADE_START_MS`, lineal hasta 0 en `EXTRAPOLATE_MAX_MS`. */
export function ageOpacity(ageMs: number): number {
  if (ageMs <= FADE_START_MS) return 1;
  if (ageMs >= EXTRAPOLATE_MAX_MS) return 0;
  return 1 - (ageMs - FADE_START_MS) / (EXTRAPOLATE_MAX_MS - FADE_START_MS);
}

/** Desplaza (lon, lat) `meters` hacia `headingDeg` (plano local, válido a decenas de km). */
export function offsetLonLat(
  lon: number,
  lat: number,
  headingDeg: number,
  meters: number,
): [number, number] {
  const rad = (headingDeg * Math.PI) / 180;
  const dy = (Math.cos(rad) * meters) / M_PER_DEG_LAT;
  const dx = (Math.sin(rad) * meters) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return [lon + dx, lat + dy];
}

export function estimate(p: PlaneInfo, now: number): PlaneEstimate {
  const ageMs = Math.max(0, now - p.ts);
  const opacity = ageOpacity(ageMs);
  if (!canExtrapolate(p)) return { lon: p.lon, lat: p.lat, ageMs, extrapolated: false, opacity };
  const seconds = Math.min(ageMs, EXTRAPOLATE_MAX_MS) / 1000;
  const [lon, lat] = offsetLonLat(p.lon, p.lat, p.heading as number, (p.speed as number) * seconds);
  return { lon, lat, ageMs, extrapolated: seconds > 0, opacity };
}
