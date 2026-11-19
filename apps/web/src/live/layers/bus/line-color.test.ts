import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUS_FALLBACK_COLOR,
  BUS_PALETTE,
  BUS_TOKEN,
  FOCUS_COLOR,
  colorForLine,
  deriveBusPalette,
  hexToRgb,
  lineSlot,
  type Rgb,
} from "./line-color";

const tokens = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
const token = (name: string): string =>
  new RegExp(`--pulso-${name}:\\s*(#[0-9a-f]{6})`, "i").exec(tokens)?.[1] ?? "";

const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

// Simulación de dicromasia (Machado et al. 2009, severidad 1,0) y ΔE76, como en direccion.md.
const MACHADO = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
} as const; // prettier-ignore

const unlin = (v: number): number =>
  255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
function simulate(rgb: Rgb, m: readonly (readonly number[])[]): Rgb {
  const l = rgb.map(lin) as [number, number, number];
  return m.map((row) =>
    Math.min(
      255,
      Math.max(0, unlin((row[0] ?? 0) * l[0] + (row[1] ?? 0) * l[1] + (row[2] ?? 0) * l[2])),
    ),
  ) as unknown as Rgb;
}
function lab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(lin) as [number, number, number];
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function deltaE(a: Rgb, b: Rgb): number {
  const [la, lb] = [lab(a), lab(b)];
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}
const minDeltaE = (a: Rgb, b: Rgb): number =>
  Math.min(...Object.values(MACHADO).map((m) => deltaE(simulate(a, m), simulate(b, m))));

describe("color por línea", () => {
  it("el token base coincide con tokens.css y la primera variante es el propio token", () => {
    expect(BUS_TOKEN).toBe(token("bus"));
    expect(BUS_PALETTE[0]).toEqual(hexToRgb(token("bus")));
    expect(hexToRgb(token("focus"))).toEqual(FOCUS_COLOR);
    expect(BUS_FALLBACK_COLOR).toEqual(hexToRgb(token("bus")));
  });

  it("es estable: la misma línea da siempre el mismo color, sin importar mayúsculas ni espacios", () => {
    expect(colorForLine("3A")).toEqual(colorForLine("3A"));
    expect(colorForLine(" 3a ")).toEqual(colorForLine("3A"));
    expect(lineSlot("S1")).toBe(lineSlot("s1"));
    // Valores fijos: cambiarlos recolorearía las líneas de todo el mundo.
    expect(lineSlot("1")).toBe(1);
    expect(lineSlot("7")).toBe(7);
    expect(deriveBusPalette()).toEqual(BUS_PALETTE);
  });

  it("las líneas numéricas consecutivas reciben variantes distintas", () => {
    const slots = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => lineSlot(String(n)));
    expect(new Set(slots).size).toBe(8);
  });

  it("sin línea usa el token; una línea desconocida usa una variante de la paleta", () => {
    expect(colorForLine(undefined)).toEqual(BUS_FALLBACK_COLOR);
    expect(colorForLine("  ")).toEqual(BUS_FALLBACK_COLOR);
    expect(BUS_PALETTE).toContainEqual(colorForLine("N7X"));
  });

  it("todas las variantes son legibles sobre el fondo (≥ 7:1, tokens.md)", () => {
    const bg = hexToRgb(token("bg"));
    for (const c of BUS_PALETTE) expect(contrast(c, bg)).toBeGreaterThanOrEqual(7);
  });

  it("las variantes se distinguen entre sí también con daltonismo (ΔE ≥ 10)", () => {
    for (let i = 0; i < BUS_PALETTE.length; i++) {
      for (let j = i + 1; j < BUS_PALETTE.length; j++) {
        expect(
          minDeltaE(BUS_PALETTE[i] as Rgb, BUS_PALETTE[j] as Rgb),
          `${i}-${j}`,
        ).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("ninguna variante se confunde con las demás tonalidades de capa (ΔE normal ≥ 20)", () => {
    for (const name of ["bike", "wind", "sea", "ship", "air", "plane", "train"]) {
      const other = hexToRgb(token(name));
      for (const c of BUS_PALETTE) expect(deltaE(c, other), name).toBeGreaterThanOrEqual(20);
    }
  });
});
