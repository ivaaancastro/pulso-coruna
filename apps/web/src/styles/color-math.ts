/**
 * Matemática de color para las pruebas de accesibilidad (M8.2): contraste WCAG 2.1 y simulación de
 * daltonismo. Solo la usan los tests; no entra en el JS de la app.
 */

export type Rgb = readonly [number, number, number];

export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) throw new Error(`Color hexadecimal no válido: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (l: number): number => {
  const c = Math.min(1, Math.max(0, l));
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
};

function linear(rgb: Rgb): [number, number, number] {
  return [toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2])];
}

export function luminance(rgb: Rgb): number {
  const [r, g, b] = linear(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Relación de contraste WCAG 2.1 (1–21). */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type Deficiency = "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia";

type Matrix = readonly (readonly [number, number, number])[];

/** Machado, Oliveira y Fernandes (2009), severidad 1,0, sobre RGB lineal. */
const MATRICES: Record<Exclude<Deficiency, "achromatopsia">, Matrix> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export function simulate(rgb: Rgb, kind: Deficiency): Rgb {
  const [r, g, b] = linear(rgb);
  if (kind === "achromatopsia") {
    const y = fromLinear(0.2126 * r + 0.7152 * g + 0.0722 * b);
    return [y, y, y];
  }
  const [row0, row1, row2] = MATRICES[kind] as [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  const mix = (row: [number, number, number]): number =>
    fromLinear(row[0] * r + row[1] * g + row[2] * b);
  return [mix(row0), mix(row1), mix(row2)];
}

/** CIE L*a*b* (D65). */
export function toLab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = linear(rgb);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (v: number): number => (v > 216 / 24389 ? Math.cbrt(v) : ((24389 / 27) * v + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Diferencia de color CIE76 (distancia euclídea en Lab). */
export function deltaE(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
