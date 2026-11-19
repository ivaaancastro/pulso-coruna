#!/usr/bin/env node
/* global process, console */
// Mide el peso gzip de dist/ contra apps/web/perf-budget.json.
// - JS inicial: scripts y modulepreload que referencia dist/index.html, salvo los chunks de mapa.
// - JS diferido (mapa + deck.gl + capas): todos los .js de dist/ que no son iniciales ni el service worker
//   ni un worker (bundle.excludeChunkPattern). Cuenta también los chunks que añadan capas nuevas, sin
//   depender de su nombre. Si no existe ninguno, se omite.
// Uso: node perf/check-bundle.mjs [--dist dist] [--budget perf-budget.json]
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function gzipSize(file) {
  return gzipSync(readFileSync(file), { level: 9 }).length;
}

function listJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listJs(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

/** Rutas (relativas a dist) de los JS que carga index.html al inicio. */
function initialScripts(html) {
  const found = new Set();
  const re = /<(script|link)\b[^>]*>/g;
  for (const m of html.matchAll(re)) {
    const tag = m[0];
    const attr = m[1] === "script" ? "src" : "href";
    const url = new RegExp(`\\s${attr}=["']([^"']+\\.js)["']`).exec(tag);
    if (!url) continue;
    if (m[1] === "link" && !/rel=["']modulepreload["']/.test(tag)) continue;
    found.add(url[1].replace(/^\.?\//, ""));
  }
  return [...found];
}

export function check({ dist, budget }) {
  const { mapChunkPattern, excludeChunkPattern, initialJsGzipMaxKB, mapChunkGzipMaxKB } =
    budget.bundle;
  const isMap = new RegExp(mapChunkPattern, "i");
  const isExcluded = new RegExp(excludeChunkPattern, "i");
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const initial = initialScripts(html).filter((f) => !isMap.test(f));
  const mapFiles = listJs(dist)
    .map((f) => f.slice(dist.length + 1))
    .filter((f) => !initial.includes(f) && !isExcluded.test(f));
  const sum = (files) => files.reduce((n, f) => n + gzipSize(join(dist, f)), 0) / 1024;

  const rows = [
    {
      name: "JS inicial (gzip)",
      files: initial,
      kb: sum(initial),
      max: initialJsGzipMaxKB,
      error: initial.length === 0 ? "index.html no referencia ningún JS" : undefined,
    },
    {
      name: "JS diferido mapa+deck.gl+capas (gzip)",
      files: mapFiles,
      kb: mapFiles.length > 0 ? sum(mapFiles) : null,
      max: mapChunkGzipMaxKB,
    },
  ];
  return rows;
}

function main() {
  const dist = resolve(webRoot, arg("dist", "dist"));
  const budgetPath = resolve(webRoot, arg("budget", "perf-budget.json"));
  if (!existsSync(join(dist, "index.html"))) {
    console.error(`No hay build en ${dist}: ejecuta pnpm --filter @pulso/web build`);
    process.exit(2);
  }
  const rows = check({ dist, budget: JSON.parse(readFileSync(budgetPath, "utf8")) });
  let failed = false;
  for (const r of rows) {
    if (r.error) {
      failed = true;
      console.error(`FAIL ${r.name}: ${r.error}`);
    } else if (r.kb === null) {
      console.log(`SKIP ${r.name}: no existe todavía (presupuesto ${r.max} KB)`);
    } else if (r.kb >= r.max) {
      failed = true;
      console.error(
        `FAIL ${r.name}: ${r.kb.toFixed(1)} KB >= ${r.max} KB  [${r.files.join(", ")}]`,
      );
    } else {
      console.log(`OK   ${r.name}: ${r.kb.toFixed(1)} KB < ${r.max} KB  [${r.files.join(", ")}]`);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
