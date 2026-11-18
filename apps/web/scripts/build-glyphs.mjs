// Genera los glifos SDF (PBF) que MapLibre pide en /glyphs/{fontstack}/{range}.pbf.
// Fuente: Archivo (OFL 1.1), ya autoalojada en public/fonts. Las herramientas NO son
// dependencias del proyecto: se instalan en un directorio temporal. Uso:
//   TMP=$(mktemp -d) && npm i --prefix "$TMP" fontnik wawoff2
//   NODE_PATH="$TMP/node_modules" node apps/web/scripts/build-glyphs.mjs
// Escribe public/glyphs/Archivo Regular/{0-255,8192-8447}.pbf (instancia por defecto: wght 400, wdth 100).
/* global process, console, Buffer */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(join(process.env.NODE_PATH ?? ".", "x.js"));
const fontnik = require("fontnik");
const wawoff2 = require("wawoff2");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const woff2 = readFileSync(join(root, "public/fonts/archivo-latin-wdth-normal.woff2"));
const ttf = Buffer.from(await wawoff2.decompress(woff2));

const name = "Archivo Regular";
const out = join(root, "public/glyphs", name);
mkdirSync(out, { recursive: true });

// 0-255: latín básico y Latin-1. 8192-8447: puntuación general (’ – —).
for (const start of [0, 8192]) {
  const end = start + 255;
  const pbf = await new Promise((resolve, reject) =>
    fontnik.range({ font: ttf, start, end }, (e, d) => (e ? reject(e) : resolve(d))),
  );
  writeFileSync(join(out, `${start}-${end}.pbf`), pbf);
  console.log(`${name}/${start}-${end}.pbf`, pbf.length, "bytes");
}
