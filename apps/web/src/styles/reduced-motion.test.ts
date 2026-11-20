import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * prefers-reduced-motion (M8.2): toda regla CSS con `transition` o `animation` debe tener su
 * contraparte dentro de un `@media (prefers-reduced-motion: reduce)` del mismo fichero. Las
 * animaciones de JS (cámara, contador, partículas, estelas) tienen sus propios tests junto al código.
 */
const ROOT = resolve(__dirname, "..");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

/** Cuerpo (entre llaves) del bloque que empieza en `open`, que apunta a la `{` inicial. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return i;
  }
  return css.length;
}

interface Parsed {
  /** Selectores de reglas con transición/animación fuera de reduced-motion. */
  animated: string[];
  /** Texto dentro de los bloques reduced-motion. */
  reduced: string;
}

export function parse(source: string): Parsed {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const animated: string[] = [];
  let reduced = "";
  const walk = (text: string, inReduced: boolean): void => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) return;
      const head = text.slice(i, open).trim();
      const end = blockEnd(text, open);
      const body = text.slice(open + 1, end);
      if (head.startsWith("@media")) {
        const isReduced = /prefers-reduced-motion:\s*reduce/.test(head);
        if (isReduced) reduced += `${body}\n`;
        walk(body, inReduced || isReduced);
      } else if (!head.startsWith("@")) {
        if (!inReduced && /(^|[;\s])(transition|animation)(-[a-z]+)?\s*:/.test(body)) {
          animated.push(head);
        }
      }
      i = end + 1;
    }
  };
  walk(css, false);
  return { animated, reduced };
}

describe("prefers-reduced-motion en el CSS", () => {
  const files = cssFiles(ROOT);

  it("hay hojas de estilo que revisar", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${relative(ROOT, file)}: transiciones y animaciones tienen su versión reducida`, () => {
      const { animated, reduced } = parse(readFileSync(file, "utf8"));
      const missing = animated.filter(
        (selector) =>
          // Cada selector de una lista separada por comas debe aparecer en el bloque reducido.
          !selector.split(",").every((part) => reduced.includes(part.trim())),
      );
      expect(missing).toEqual([]);
    });
  }

  it("los tokens de duración se acortan o anulan con reduced-motion", () => {
    const tokens = readFileSync(join(ROOT, "styles/tokens.css"), "utf8");
    const block = /prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? "";
    for (const name of ["fast", "base", "slow", "camera", "intro"]) {
      expect(block).toContain(`--pulso-dur-${name}:`);
    }
  });

  it("el analizador detecta una regla sin versión reducida", () => {
    const sample =
      ".a { transition: color 1s; } .b { animation: x 1s; } @media (prefers-reduced-motion: reduce) { .b { animation: none; } }";
    const { animated, reduced } = parse(sample);
    expect(animated).toEqual([".a", ".b"]);
    expect(reduced).toContain(".b");
    expect(reduced).not.toContain(".a");
  });
});
