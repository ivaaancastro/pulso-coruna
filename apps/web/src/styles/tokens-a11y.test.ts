import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, deltaE, parseHex, simulate, type Deficiency } from "./color-math";

/** Tokens de color de `tokens.css` (la fuente de verdad): `--pulso-x: #rrggbb`. */
const css = readFileSync(resolve(__dirname, "tokens.css"), "utf8");
const tokens = new Map<string, string>();
for (const m of css.matchAll(/--pulso-([a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
  if (m[1] && m[2]) tokens.set(m[1], m[2]);
}
const rgb = (name: string) => {
  const hex = tokens.get(name);
  if (!hex)
    throw new Error(
      `Falta el token --pulso-${name} en tokens.css (los tokens de color deben ser hexadecimales de 6 dígitos, #rrggbb, para que el test los lea)`,
    );
  return parseHex(hex);
};

const SURFACES = ["bg", "surface", "surface-overlay"] as const;
const LAYERS = ["bus", "bike", "wind", "sea", "ship", "air", "plane", "train"] as const;
const GROUND = ["bg", "land", "water", "water-deep", "building"] as const;

describe("contraste AA de los tokens (WCAG 2.1)", () => {
  // Texto normal (<18 px): >= 4,5. Se exige a todo el texto de la UI, también al grande.
  const text: [string, readonly string[]][] = [
    ["text", SURFACES],
    ["text-muted", SURFACES],
    ["text-subtle", SURFACES],
    ["warn", SURFACES],
    ["error", SURFACES],
    // Cifra del índice y etiquetas con el color de la capa.
    ["bus", SURFACES],
    ["bike", SURFACES],
    ["sea", SURFACES],
    ["ship", SURFACES],
    ["air", SURFACES],
  ];
  for (const [fg, backgrounds] of text) {
    for (const bg of backgrounds) {
      it(`texto ${fg} sobre ${bg} >= 4,5`, () => {
        expect(contrast(rgb(fg), rgb(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("texto muted/subtle también sobre el mapa de noche (agua y tierra) >= 4,5", () => {
    for (const fg of ["text", "text-muted", "text-subtle"]) {
      for (const bg of ["land", "water", "water-deep"]) {
        expect(contrast(rgb(fg), rgb(bg)), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("texto invertido (píldora seleccionada y distintivo de línea) >= 4,5", () => {
    expect(contrast(rgb("bg"), rgb("text"))).toBeGreaterThanOrEqual(4.5);
    for (const layer of LAYERS) {
      expect(contrast(rgb("bg"), rgb(layer)), `bg sobre ${layer}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // Componentes de UI y objetos gráficos: >= 3.
  it("borde de los controles >= 3 sobre el fondo y las superficies", () => {
    for (const s of SURFACES) {
      expect(contrast(rgb("border-control"), rgb(s)), s).toBeGreaterThanOrEqual(3);
    }
  });

  it("anillo de foco >= 3 sobre fondo, superficies y mapa", () => {
    for (const s of [...SURFACES, ...GROUND, "coast"]) {
      expect(contrast(rgb("focus"), rgb(s)), s).toBeGreaterThanOrEqual(3);
    }
  });

  it("colores de capa >= 3 sobre el mapa (agua, tierra, edificios)", () => {
    for (const layer of LAYERS) {
      for (const ground of GROUND) {
        const ratio = contrast(rgb(layer), rgb(ground));
        expect(ratio, `${layer} sobre ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("paleta de capas apta para daltonismo", () => {
  const kinds: Deficiency[] = ["protanopia", "deuteranopia", "tritanopia"];

  // Bajo cada simulación (Machado 2009, severidad 1,0) los pares de capas se separan por color
  // (CIE76) salvo los listados aquí, que se distinguen por forma y comportamiento (ADR 0028).
  const MIN_DELTA_E = 10;
  const EXCEPTIONS: Record<string, string> = {
    // La capa de tren aún no se dibuja; si llega, forma de cuadrado sobre vía (direccion.md).
    "sea/train": "deuteranopia",
  };

  for (const kind of kinds) {
    it(`${kind}: capas separables (ΔE >= ${MIN_DELTA_E}) salvo excepciones documentadas`, () => {
      const failures: string[] = [];
      for (let i = 0; i < LAYERS.length; i++) {
        for (let j = i + 1; j < LAYERS.length; j++) {
          const a = LAYERS[i];
          const b = LAYERS[j];
          if (!a || !b) continue;
          const d = deltaE(simulate(rgb(a), kind), simulate(rgb(b), kind));
          if (d < MIN_DELTA_E && EXCEPTIONS[`${a}/${b}`] !== kind) {
            failures.push(`${a}/${b}=${d.toFixed(1)}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it("las excepciones siguen siendo necesarias (si la paleta mejora, se quitan)", () => {
    for (const [pair, kind] of Object.entries(EXCEPTIONS)) {
      const [a, b] = pair.split("/");
      if (!a || !b) continue;
      expect(
        deltaE(simulate(rgb(a), kind as Deficiency), simulate(rgb(b), kind as Deficiency)),
      ).toBeLessThan(MIN_DELTA_E);
    }
  });

  // Acromatopsia: solo queda la luminosidad, así que varias capas coinciden en gris. Lo que las
  // separa es la forma, y direccion.md la fija distinta para cada una.
  it("acromatopsia: cada capa tiene una forma redundante propia (direccion.md)", () => {
    const doc = readFileSync(resolve(__dirname, "../../../../docs/design/direccion.md"), "utf8");
    const shapes = new Map<string, string>();
    for (const m of doc.matchAll(
      /^\|[^|]+\|\s*`([a-z]+)`\s*\|\s*`#[0-9A-Fa-f]{6}`\s*\|([^|]+)\|/gm,
    )) {
      if (m[1] && m[2]) shapes.set(m[1], m[2].trim());
    }
    for (const layer of LAYERS) expect(shapes.get(layer), layer).toBeTruthy();
    expect(new Set(shapes.values()).size).toBe(shapes.size);
  });
});
