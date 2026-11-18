import { sunPosition } from "./sun";

/**
 * Paleta del mapa base según la luz real. La fase se decide por la elevación solar en A Coruña
 * (UTC, sin zona horaria: Europe/Madrid solo existe al mostrar la hora en el shell). El mapa
 * sigue siendo oscuro de día: «solo brilla el dato» (docs/design/direccion.md). La noche usa
 * exactamente los tokens aprobados; amanecer, atardecer y día son desplazamientos suaves de ella.
 */
export type Phase = "night" | "dawn" | "day" | "dusk";

export interface Light {
  /** Color de la luz sobre los edificios. */
  color: string;
  intensity: number;
  /** Ángulo azimutal MapLibre (grados; 0 = luz desde el norte del mapa). */
  azimuth: number;
  /** Ángulo polar MapLibre (0 = cenital, 90 = rasante). */
  polar: number;
}

export interface MapColors {
  bg: string;
  land: string;
  /** Tierra «blanda» (parques, cubierta vegetal): apenas más clara que la tierra. */
  landSoft: string;
  water: string;
  waterDeep: string;
  coast: string;
  /** Tinte de la orilla (luz difusa sobre el agua junto a la costa). */
  shore: string;
  building: string;
  /** Edificios altos: algo más claros para dar profundidad. */
  buildingTall: string;
  road: string;
  roadMajor: string;
  label: string;
  labelStrong: string;
  waterLabel: string;
  lightColor: string;
}

export interface MapPalette extends MapColors {
  phase: Phase;
  /** Elevación solar usada (grados), útil para depurar y para tests. */
  sunElevation: number;
  light: Light;
  lightIntensity: number;
}

type Keyframe = MapColors & { lightIntensity: number };

// Noche: tokens de docs/design/tokens.md (bg, land, water, water-deep, coast, building).
const NIGHT: Keyframe = {
  bg: "#05080e",
  land: "#0a0f19",
  landSoft: "#0c1320",
  water: "#0b2236",
  waterDeep: "#06131f",
  coast: "#1e3a55",
  shore: "#1a4468",
  building: "#1a2438",
  buildingTall: "#25324b",
  road: "#131b2b",
  roadMajor: "#1c2740",
  label: "#6b7893",
  labelStrong: "#8e9bb0",
  waterLabel: "#2d5272",
  lightColor: "#b4c6e6",
  lightIntensity: 0.3,
};

const DAWN: Keyframe = {
  bg: "#0d0b15",
  land: "#141521",
  landSoft: "#171a27",
  water: "#17304c",
  waterDeep: "#0a1829",
  coast: "#5d6788",
  shore: "#233e5c",
  building: "#34344c",
  buildingTall: "#44445e",
  road: "#1e1d2c",
  roadMajor: "#2a2740",
  label: "#8e8aa6",
  labelStrong: "#aaa6bf",
  waterLabel: "#4a6a8c",
  lightColor: "#ffb08a",
  lightIntensity: 0.4,
};

const DUSK: Keyframe = {
  bg: "#120b11",
  land: "#181420",
  landSoft: "#1b1824",
  water: "#1a2a44",
  waterDeep: "#0b1626",
  coast: "#86667a",
  shore: "#2a3c57",
  building: "#3a3342",
  buildingTall: "#4c4458",
  road: "#221b27",
  roadMajor: "#322a38",
  label: "#a08e9c",
  labelStrong: "#bba8b5",
  waterLabel: "#5d6a88",
  lightColor: "#ff9a5c",
  lightIntensity: 0.42,
};

const DAY: Keyframe = {
  bg: "#0a1220",
  land: "#121b2a",
  landSoft: "#162235",
  water: "#14405f",
  waterDeep: "#0b2840",
  coast: "#4a86ac",
  shore: "#1c5478",
  building: "#2f405a",
  buildingTall: "#3e5070",
  road: "#1b2638",
  roadMajor: "#2a3850",
  label: "#8e9bb0",
  labelStrong: "#b4c0d2",
  waterLabel: "#5b88aa",
  lightColor: "#fff3dc",
  lightIntensity: 0.5,
};

/** Elevación solar (°) en la que se alcanza cada paleta pura. */
const E_NIGHT = -8;
const E_TWILIGHT = 0;
const E_DAY = 12;

/** Dirección fija de la luz fría de noche (azimut MapLibre). */
const NIGHT_AZIMUTH = 215;
const NIGHT_POLAR = 70;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smooth = (t: number): number => t * t * (3 - 2 * t);

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: readonly number[]): string {
  return `#${rgb
    .map((c) =>
      Math.round(clamp(c, 0, 255))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function mixHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => (ra[i] ?? 0) + ((rb[i] ?? 0) - (ra[i] ?? 0)) * t));
}

function mixAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

const COLOR_KEYS: readonly (keyof MapColors)[] = [
  "bg",
  "land",
  "landSoft",
  "water",
  "waterDeep",
  "coast",
  "shore",
  "building",
  "buildingTall",
  "road",
  "roadMajor",
  "label",
  "labelStrong",
  "waterLabel",
  "lightColor",
];

function mixKeyframes(a: Keyframe, b: Keyframe, t: number): Keyframe {
  const out: Keyframe = { ...a };
  for (const key of COLOR_KEYS) out[key] = mixHex(a[key], b[key], t);
  out.lightIntensity = a.lightIntensity + (b.lightIntensity - a.lightIntensity) * t;
  return out;
}

/** Fase discreta a partir de la elevación solar (etiquetas, depuración y tests). */
export function phaseFor(elevation: number, morning: boolean): Phase {
  if (elevation < -6) return "night";
  if (elevation > 8) return "day";
  return morning ? "dawn" : "dusk";
}

/** Paleta continua: la mezcla entre fases evita saltos al cruzar el umbral. */
export function paletteAt(epochMs: number): MapPalette {
  const sun = sunPosition(epochMs);
  const e = sun.elevation;
  const twilight = sun.morning ? DAWN : DUSK;

  let frame: Keyframe;
  if (e <= E_NIGHT) {
    frame = NIGHT;
  } else if (e < E_TWILIGHT) {
    frame = mixKeyframes(NIGHT, twilight, smooth((e - E_NIGHT) / (E_TWILIGHT - E_NIGHT)));
  } else if (e < E_DAY) {
    frame = mixKeyframes(twilight, DAY, smooth((e - E_TWILIGHT) / (E_DAY - E_TWILIGHT)));
  } else {
    frame = DAY;
  }

  // Luz: sigue al sol; bajo el horizonte vuelve a la luz fría y fija de la noche.
  const follow = smooth(clamp((e - E_NIGHT) / (E_TWILIGHT + 4 - E_NIGHT), 0, 1));
  const sunPolar = clamp(90 - Math.max(e, 12), 22, 78);
  const light: Light = {
    color: frame.lightColor,
    intensity: frame.lightIntensity,
    azimuth: mixAngle(NIGHT_AZIMUTH, sun.azimuth, follow),
    polar: NIGHT_POLAR + (sunPolar - NIGHT_POLAR) * follow,
  };

  return { ...frame, phase: phaseFor(e, sun.morning), sunElevation: e, light };
}
