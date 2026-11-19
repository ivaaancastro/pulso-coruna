/**
 * Color estable por línea de bus. Sin colores nuevos: todos son variantes del token `--pulso-bus`
 * (docs/design/tokens.md) con un desplazamiento de tono, de saturación y de luminosidad (HSL).
 * Receta calculada con un barrido (ver `docs/specs/M4.3b-capa-bus.md`): se evita acercarse al resto
 * de tonalidades de capa (barco, bici…) y se maximiza la distancia mínima entre variantes también
 * con protanopía, deuteranopía y tritanopía (ΔE76 ≥ 10). El mapa es oscuro de día y de noche
 * («solo brilla el dato»), así que una sola paleta sirve para toda la luz; todas superan 7:1 de
 * contraste sobre `--pulso-bg`. El color nunca va solo: la tarjeta nombra la línea.
 */
export type Rgb = readonly [number, number, number];

/** `--pulso-bus` (tokens.md). Un test comprueba que coincide con `styles/tokens.css`. */
export const BUS_TOKEN = "#ffc23d";

/** Receta: [desplazamiento de tono (°), escala de saturación, luminosidad (0–1) o `null` = la del token]. */
const RECIPE: readonly (readonly [number, number, number | null])[] = [
  [0, 1, null], // el propio token
  [40, 1, 0.86],
  [15, 0.6, 0.66],
  [-10, 0.6, 0.54],
  [-10, 0.8, 0.5],
  [35, 1, 0.5],
  [15, 1, 0.78],
  [-10, 1, 0.66],
];

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor((((h % 360) + 360) % 360) / 60);
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector] as [number, number, number];
  return [r + m, g + m, b + m].map((v) => Math.round(v * 255)) as [number, number, number];
}

/** Variantes del token base, en el orden de la receta (la primera es el propio token). */
export function deriveBusPalette(baseHex: string = BUS_TOKEN): Rgb[] {
  const base = hexToRgb(baseHex);
  const [h, s, l] = rgbToHsl(base);
  return RECIPE.map(([dh, ds, dl], i) =>
    i === 0 ? base : hslToRgb((h + dh + 360) % 360, Math.min(1, s * ds), dl ?? l),
  );
}

export const BUS_PALETTE: readonly Rgb[] = deriveBusPalette();

/** Color de un bus sin línea conocida: el token tal cual. */
export const BUS_FALLBACK_COLOR: Rgb = BUS_PALETTE[0] as Rgb;

/** FNV-1a de 32 bits: estable entre sesiones y dispositivos. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Posición de la línea en la paleta: numéricas consecutivas quedan en variantes distintas. */
export function lineSlot(line: string, size: number = BUS_PALETTE.length): number {
  const key = line.trim().toUpperCase();
  const match = /^(\d+)(.*)$/.exec(key);
  if (match) {
    const suffix = match[2] ?? "";
    return (Number(match[1]) + (suffix === "" ? 0 : fnv1a(suffix))) % size;
  }
  return fnv1a(key) % size;
}

/** Color de una línea; sin línea (`undefined` o vacía) devuelve el del token. */
export function colorForLine(line: string | undefined): Rgb {
  if (line === undefined || line.trim() === "") return BUS_FALLBACK_COLOR;
  return BUS_PALETTE[lineSlot(line)] ?? BUS_FALLBACK_COLOR;
}
