import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./index";

/**
 * M8.1: ninguna cadena de interfaz fuera de `src/i18n/`. Estático (AST de TypeScript, sin red):
 *  (a) un literal que va a un destino visible o accesible (`textContent`, `title`, `aria-label`,
 *      propiedades `text|label|title|kicker|message|note|heading`, 3.er argumento de `el()`);
 *  (b) un literal que parece prosa (dos o más palabras, o acentos y ñ) en cualquier otro sitio, salvo
 *      contextos que no se muestran (consola, `Error`, tipos, comparaciones, clases CSS, selectores…).
 * Si salta un falso positivo legítimo, se añade a `ALLOWED` con el motivo; si es un texto real, a i18n.
 */

const SRC = resolve(process.cwd(), "src");

/** Carpetas fuera de la auditoría: catálogos y simulador de desarrollo (no entra en el build). */
const SKIPPED_DIRS = ["i18n", join("live", "dev")];

interface Allowed {
  file: string;
  text: string;
  why: string;
}

const ALLOWED: readonly Allowed[] = [
  {
    file: "map/map.ts",
    text: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ',
    why: "Atribución legal con el texto exigido por OpenStreetMap (ODbL): no se traduce.",
  },
  {
    file: "map/map.ts",
    text: '<a href="https://www.catastro.hacienda.gob.es/" target="_blank" rel="noopener">© Dirección General del Catastro (Ministerio de Hacienda)</a>',
    why: "Atribución legal con el nombre oficial del titular de los datos: no se traduce.",
  },
  {
    file: "map/style.ts",
    text: "Torre de Hércules",
    why: "Topónimo del mapa base (etiqueta de la propia capa de teselas), igual en los tres idiomas.",
  },
  {
    file: "map/style.ts",
    text: "Archivo Regular",
    why: "Nombre de la fuente de glifos del mapa (identificador técnico).",
  },
  {
    file: "live/protocol.ts",
    text: "mensaje no textual",
    why: "Motivo técnico de descarte; solo va a la consola, nunca a la interfaz.",
  },
  {
    file: "live/protocol.ts",
    text: "JSON inválido",
    why: "Motivo técnico de descarte; solo va a la consola, nunca a la interfaz.",
  },
  {
    file: "live/protocol.ts",
    text: "inválido",
    why: "Motivo técnico de descarte; solo va a la consola, nunca a la interfaz.",
  },
  {
    file: "live/sea/station.ts",
    text: "A Coruña",
    why: "Nombre propio de la estación de marea (dato de la tabla); la tarjeta usa sea.* de i18n.",
  },
  {
    file: "live/wind/stations.ts",
    text: "Coruña-Dique",
    why: "Nombre propio de la estación en la tabla de coordenadas; no se muestra.",
  },
  {
    file: "map/style.ts",
    text: "Pulso Faro",
    why: "Nombre interno del estilo MapLibre; no se muestra.",
  },
  {
    file: "live/air/stations.ts",
    text: "A Coruña (modelo CAMS)",
    why: "Clave de datos de la tabla de puntos; no se muestra (la tarjeta usa air.* de i18n).",
  },
  {
    file: "live/wind/stations.ts",
    text: "Punta Langosteira",
    why: "Nombre propio de la estación en la tabla de coordenadas; no se muestra.",
  },
  {
    file: "live/wind/stations.ts",
    text: "Simulada 1",
    why: "Estación del simulador de desarrollo; no existe en producción.",
  },
  {
    file: "live/wind/stations.ts",
    text: "Simulada 2",
    why: "Estación del simulador de desarrollo; no existe en producción.",
  },
  {
    file: "live/wind/stations.ts",
    text: "Simulada 3",
    why: "Estación del simulador de desarrollo; no existe en producción.",
  },
  {
    file: "live/air/stations.ts",
    text: "A Coruña (simulado)",
    why: "Punto del simulador de desarrollo; no existe en producción ni se muestra.",
  },
  {
    file: "live/air/model.ts",
    text: "PM2.5",
    why: "Símbolo químico/norma: igual en todos los idiomas.",
  },
  { file: "live/air/model.ts", text: "PM10", why: "Símbolo químico/norma." },
  { file: "live/air/model.ts", text: "NO₂", why: "Símbolo químico." },
  { file: "live/air/model.ts", text: "O₃", why: "Símbolo químico." },
  { file: "live/air/model.ts", text: "SO₂", why: "Símbolo químico." },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(SRC, path);
    if (statSync(path).isDirectory()) {
      if (!SKIPPED_DIRS.includes(rel)) out.push(...sourceFiles(path));
    } else if (
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".d.ts") &&
      name !== "test-helpers.ts"
    ) {
      out.push(path);
    }
  }
  return out;
}

const SINK_PROPERTIES = new Set([
  "textContent",
  "innerText",
  "title",
  "alt",
  "placeholder",
  "ariaLabel",
]);
const SINK_ATTRIBUTES = new Set([
  "aria-label",
  "aria-valuetext",
  "aria-description",
  "aria-roledescription",
  "title",
  "alt",
  "placeholder",
]);
const SINK_KEYS = new Set(["text", "label", "title", "kicker", "message", "note", "heading"]);
/** Llamadas cuyos argumentos nunca son texto visible. */
const SILENT_CALLEES =
  /^(console\.\w+|[\w.]*\.?(querySelector(All)?|closest|matches|getAttribute|hasAttribute|removeAttribute|createElement(NS)?|addEventListener|removeEventListener|getElementById|getPropertyValue|setProperty|toggle|add|remove|contains|has|get|set|import|require|URLSearchParams|RegExp|Symbol|Object\.hasOwn|JSON\.\w+|postMessage|new URL|fetch))$/;

const hasLetters = (s: string): boolean => /\p{L}/u.test(s);
const hexColor = (s: string): boolean => /^#[0-9a-f]{3,8}$/i.test(s);

/** «Parece prosa»: palabras con espacio entre ellas, o acentos/ñ/¿/¡ típicos de castellano y gallego. */
function looksLikeProse(s: string): boolean {
  if (/[áéíóúñÁÉÍÓÚÑ¿¡]/.test(s)) return true;
  const words = s.split(/\s+/).filter((w) => /^[\p{L}'’]{2,}[.,;:!?…)]?$/u.test(w));
  return words.length >= 2;
}

/** Literales que acaban tal cual en `expr` (ramas de `?:`, `||`, `??`, `+`, plantillas). */
function literalsOf(expr: ts.Expression): string[] {
  if (ts.isStringLiteralLike(expr)) return [expr.text];
  if (ts.isTemplateExpression(expr)) {
    return [expr.head.text, ...expr.templateSpans.map((s) => s.literal.text)];
  }
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr))
    return literalsOf(expr.expression);
  if (ts.isConditionalExpression(expr))
    return [...literalsOf(expr.whenTrue), ...literalsOf(expr.whenFalse)];
  if (ts.isBinaryExpression(expr)) {
    const k = expr.operatorToken.kind;
    if (
      k === ts.SyntaxKind.BarBarToken ||
      k === ts.SyntaxKind.QuestionQuestionToken ||
      k === ts.SyntaxKind.PlusToken
    ) {
      return [...literalsOf(expr.left), ...literalsOf(expr.right)];
    }
  }
  return [];
}

const stripTags = (s: string): string => s.replace(/<[^>]*>/g, "");

function calleeText(call: ts.CallExpression | ts.NewExpression): string {
  return call.expression.getText().replace(/\?\./g, ".");
}

/** ¿El literal está en un contexto que nunca se muestra? */
function isSilent(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (
      ts.isImportDeclaration(p) ||
      ts.isExportDeclaration(p) ||
      ts.isLiteralTypeNode(p) ||
      ts.isImportTypeNode(p) ||
      ts.isThrowStatement(p) ||
      ts.isCaseClause(p) ||
      ts.isTypeNode(p)
    ) {
      return true;
    }
    if (ts.isNewExpression(p) && /Error$/.test(p.expression.getText())) return true;
    if (ts.isCallExpression(p) && SILENT_CALLEES.test(calleeText(p))) return true;
    if (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (
      ts.isBinaryExpression(p) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(p.operatorToken.kind)
    ) {
      return true;
    }
    if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
    // `x.className = "…"`, `x.type = "…"`, `x.rel = "…"`, `x.id = "…"`, `x.href = …`
    if (
      ts.isBinaryExpression(p) &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(p.left) &&
      /^(className|type|rel|id|href|target|role|name|htmlFor|lang|dateTime|style)$/.test(
        p.left.name.text,
      )
    ) {
      return true;
    }
    if (ts.isStatement(p)) break;
  }
  return false;
}

interface Finding {
  file: string;
  line: number;
  text: string;
  why: string;
}

function audit(file: string, code: string): Finding[] {
  const rel = relative(SRC, file).split("\\").join("/");
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true);
  const found: Finding[] = [];
  const seen = new Set<ts.Node>();
  const report = (node: ts.Node, text: string, why: string): void => {
    if (seen.has(node)) return;
    if (ALLOWED.some((a) => a.file === rel && a.text === text)) return;
    seen.add(node);
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    found.push({ file: rel, line, text: text.slice(0, 80), why });
  };
  const sinkLiteral = (value: string): boolean => hasLetters(stripTags(value)) && !hexColor(value);

  const visit = (node: ts.Node): void => {
    // (a) destinos visibles
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      SINK_PROPERTIES.has(node.left.name.text)
    ) {
      for (const v of literalsOf(node.right)) {
        if (sinkLiteral(v)) report(node.right, v, `literal en .${node.left.name.text}`);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === "innerHTML"
    ) {
      for (const v of literalsOf(node.right)) {
        if (hasLetters(stripTags(v))) report(node.right, v, "texto literal en .innerHTML");
      }
    }
    if (ts.isCallExpression(node)) {
      const [name, value] = node.arguments;
      if (
        node.expression.getText().endsWith("setAttribute") &&
        name &&
        ts.isStringLiteralLike(name) &&
        SINK_ATTRIBUTES.has(name.text) &&
        value
      ) {
        for (const v of literalsOf(value)) {
          if (sinkLiteral(v)) report(value, v, `literal en atributo ${name.text}`);
        }
      }
      if (node.expression.getText() === "el" && node.arguments[2]) {
        for (const v of literalsOf(node.arguments[2])) {
          if (sinkLiteral(v)) report(node.arguments[2], v, "literal como texto de el()");
        }
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) &&
      SINK_KEYS.has(node.name.text)
    ) {
      for (const v of literalsOf(node.initializer)) {
        if (sinkLiteral(v))
          report(node.initializer, v, `literal en la propiedad ${node.name.text}`);
      }
    }
    // (b) prosa en cualquier otro sitio
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const text = node.text;
      if (looksLikeProse(stripTags(text)) && !isSilent(node)) {
        report(node, text, "parece texto de interfaz");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("sin cadenas de interfaz fuera de i18n", () => {
  it("el código fuente no contiene literales visibles", () => {
    const findings = sourceFiles(SRC).flatMap((f) => audit(f, readFileSync(f, "utf8")));
    expect(
      findings.map((f) => `${f.file}:${f.line} [${f.why}] ${JSON.stringify(f.text)}`),
      "mueve el texto a src/i18n (es, gl, en) o justifícalo en ALLOWED",
    ).toEqual([]);
  });

  it("la lista de excepciones no tiene entradas muertas ni sin motivo", () => {
    for (const a of ALLOWED) {
      expect(a.why.length, `${a.file}`).toBeGreaterThan(10);
      expect(readFileSync(join(SRC, a.file), "utf8"), `${a.file}: «${a.text}»`).toContain(a.text);
    }
  });

  it("el detector detecta lo que debe (y deja pasar lo que no se muestra)", () => {
    const f = join(SRC, "x.ts");
    const bad = [
      'el.textContent = "Cerrar";',
      'button.setAttribute("aria-label", ok ? "Abrir" : t("x"));',
      'const m = { label: "Mapa" };',
      'const s = "No se pudo cargar";',
      "el.title = `Cargando ${n}`;",
      'const p = el("p", "cls", "Hola");',
      'node.innerHTML = "<b>Hola</b>";',
    ];
    for (const code of bad) expect(audit(f, code), code).not.toEqual([]);
    const good = [
      'console.warn("no se pudo iniciar");',
      'throw new Error("sin portapapeles");',
      'el.className = "air-scale air-scale--wide";',
      'el.textContent = t("clock.label");',
      'el.setAttribute("aria-hidden", "true");',
      'const c = { label: "#6b7893" };',
      'if (kind === "no data") {}',
      'document.querySelector("meta[name=description]");',
      'icon.innerHTML = "<svg viewBox=\\"0 0 24 24\\"><path d=\\"M1 1\\"/></svg>";',
      'import("./x");',
    ];
    for (const code of good) expect(audit(f, code), code).toEqual([]);
  });
});

describe("metadatos estáticos en el idioma por defecto", () => {
  const es = LOCALES[DEFAULT_LOCALE];
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

  it("index.html: lang, título y descripción coinciden con el catálogo por defecto", () => {
    expect(html).toContain(`<html lang="${DEFAULT_LOCALE}"`);
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(es["app.name"]);
    expect(/name="description"\s+content="([^"]*)"/.exec(html)?.[1]).toBe(es["app.description"]);
  });

  it("index.html no lleva texto visible en el cuerpo", () => {
    const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
    expect(stripTags(body.replace(/<script[\s\S]*?<\/script>/g, "")).trim()).toBe("");
  });

  it("los manifiestos por idioma solo difieren en lang y description, y siguen el catálogo", () => {
    const read = (name: string): Record<string, unknown> =>
      JSON.parse(readFileSync(resolve(process.cwd(), "public", name), "utf8")) as Record<
        string,
        unknown
      >;
    const base = read("manifest.webmanifest");
    expect(base["name"]).toBe(es["app.name"]);
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      const m = locale === DEFAULT_LOCALE ? base : read(`manifest.${locale}.webmanifest`);
      expect(m["lang"], locale).toBe(locale);
      expect(m["description"], locale).toBe(LOCALES[locale]["app.description"]);
      expect({ ...m, lang: "", description: "" }, locale).toEqual({
        ...base,
        lang: "",
        description: "",
      });
    }
  });
});
