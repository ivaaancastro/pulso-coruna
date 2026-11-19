import type { Entity } from "@pulso/schema";
import { kindOf, SHIP_META, type ShipKind } from "./meta";

/** `--pulso-ship` #FF7A59 y `--pulso-focus` #F5F1E4 (docs/design/tokens.md). */
export const SHIP_RGB = [255, 122, 89] as const;
export const FOCUS_RGB = [245, 241, 228] as const;

export const KNOT_MS = 0.514444;
/** Por debajo, el barco está parado (0,5 kn: el ruido del GPS no cuenta como marcha). */
export const MOORED_BELOW_MS = 0.5 * KNOT_MS;
/** Estados AIS «fondeado» y «amarrado». */
const STOPPED_STATUS = new Set([1, 5]);

/** Desde esta edad del último mensaje el barco empieza a desvanecerse, y a los 10 min desaparece. */
export const FADE_START_MS = 6 * 60_000;
export const STALE_MS = 10 * 60_000;

export type SizeClass = "large" | "medium" | "small" | "tiny";

/** Altura del icono en px por clase (la silueta mide la mitad de ancho). */
export const SIZE_PX: Readonly<Record<SizeClass, number>> = {
  large: 26,
  medium: 20,
  small: 15,
  tiny: 11,
};
export const MOORED_SCALE = 0.8;
export const MOORED_OPACITY = 0.5;
/** Zona de toque: 44 px de diámetro (tokens.md). */
export const HIT_RADIUS = 22;
export const SELECT_RADIUS = 20;

const SIZE_OF_KIND: Readonly<Record<ShipKind, SizeClass>> = {
  cargo: "large",
  tanker: "large",
  passenger: "medium",
  fishing: "small",
  tug: "small",
  service: "small",
  pleasure: "tiny",
  other: "tiny",
};

export const sizeClass = (kind: ShipKind): SizeClass => SIZE_OF_KIND[kind];

export const toKnots = (ms: number): number => ms / KNOT_MS;

/** Edad del último mensaje; un reloj forzado hacia atrás (`?t=`) no da edades negativas. */
export const ageOf = (ts: number, now: number): number => Math.max(0, now - ts);

/** 1 hasta `FADE_START_MS`, baja linealmente a 0 en `STALE_MS`. */
export function fadeFactor(ageMs: number): number {
  if (ageMs <= FADE_START_MS) return 1;
  if (ageMs >= STALE_MS) return 0;
  return 1 - (ageMs - FADE_START_MS) / (STALE_MS - FADE_START_MS);
}

/** Parado: velocidad bajo el umbral, o fondeado/amarrado cuando no hay velocidad. */
export function isMoored(speed: number | undefined, navStatus: number | undefined): boolean {
  if (speed !== undefined) return speed < MOORED_BELOW_MS;
  return navStatus !== undefined && STOPPED_STATUS.has(navStatus);
}

/** Atributos binarios por barco, en el orden del fotograma. */
export interface ShipStyle {
  /** RGBA; la opacidad ya incluye parado y desvanecimiento. */
  colors: Uint8Array;
  /** Altura del icono, px (0 = no se dibuja). */
  sizes: Float32Array;
  /** Radio de la zona de toque, px (0 = no se puede tocar). */
  hits: Float32Array;
  /** Grados antihorarios para deck.gl. */
  angles: Float32Array;
  /** 1 = navegando y al día: lleva estela. */
  trail: Uint8Array;
  /** Barcos visibles (no vencidos). */
  visible: number;
}

export interface FrameLike {
  count: number;
  ids: readonly string[];
  headings: ArrayLike<number>;
}

/** Calcula el estilo de cada barco del fotograma. `get` devuelve su último dato (o `undefined`). */
export function styleShips(
  frame: FrameLike,
  get: (id: string) => Entity | undefined,
  now: number,
): ShipStyle {
  const n = Math.min(frame.count, frame.ids.length);
  const colors = new Uint8Array(n * 4);
  const sizes = new Float32Array(n);
  const hits = new Float32Array(n);
  const angles = new Float32Array(n);
  const trail = new Uint8Array(n);
  let visible = 0;
  for (let i = 0; i < n; i++) {
    const entity = get(frame.ids[i] as string);
    if (!entity) continue; // sin dato: no se dibuja
    const fade = fadeFactor(ageOf(entity.ts, now));
    if (fade <= 0) continue;
    const navStatus = entity.meta?.[SHIP_META.navStatus];
    const moored = isMoored(entity.speed, typeof navStatus === "number" ? navStatus : undefined);
    const px = SIZE_PX[sizeClass(kindOf(entity))] * (moored ? MOORED_SCALE : 1);
    const alpha = (moored ? MOORED_OPACITY : 1) * fade;
    colors[4 * i] = SHIP_RGB[0];
    colors[4 * i + 1] = SHIP_RGB[1];
    colors[4 * i + 2] = SHIP_RGB[2];
    colors[4 * i + 3] = Math.round(255 * alpha);
    sizes[i] = px;
    hits[i] = HIT_RADIUS;
    angles[i] = -(frame.headings[i] as number); // deck.gl gira en sentido antihorario
    trail[i] = !moored && fade >= 1 ? 1 : 0;
    visible++;
  }
  return { colors, sizes, hits, angles, trail, visible };
}
