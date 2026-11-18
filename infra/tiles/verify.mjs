#!/usr/bin/env node
// Verifica un .pmtiles sin dependencias: cabecera, bbox, zooms, capas y edificios con altura.
// Uso: node infra/tiles/verify.mjs [ruta.pmtiles] [--max-mb 15]
import { readFileSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const maxIdx = args.indexOf("--max-mb");
const maxMb = maxIdx >= 0 ? Number(args.splice(maxIdx, 2)[1]) : 15;
const file = args[0] ?? join(dirname(fileURLToPath(import.meta.url)), ".work", "coruna.pmtiles");

const buf = readFileSync(file);
const size = statSync(file).size;
const fail = [];

if (buf.toString("latin1", 0, 7) !== "PMTiles" || buf[7] !== 3) {
  console.error("No es un PMTiles v3");
  process.exit(1);
}
const u64 = (o) => Number(buf.readBigUInt64LE(o));
const h = {
  rootOff: u64(8),
  rootLen: u64(16),
  metaOff: u64(24),
  metaLen: u64(32),
  leafOff: u64(40),
  dataOff: u64(56),
  tiles: u64(72),
  internalComp: buf[97],
  tileComp: buf[98],
  tileType: buf[99],
  minZ: buf[100],
  maxZ: buf[101],
  bbox: [102, 106, 110, 114].map((o, i) => buf.readInt32LE(o) / 1e7),
};
const unz = (b, c) => (c === 2 ? gunzipSync(b) : b);

function varints(b, state) {
  let r = 0n;
  let s = 0n;
  for (;;) {
    const x = b[state.p++];
    r |= BigInt(x & 0x7f) << s;
    if (!(x & 0x80)) return Number(r);
    s += 7n;
  }
}

function readDir(off, len) {
  const b = unz(buf.subarray(off, off + len), h.internalComp);
  const st = { p: 0 };
  const n = varints(b, st);
  const e = Array.from({ length: n }, () => ({}));
  let id = 0;
  for (const x of e) {
    id += varints(b, st);
    x.id = id;
  }
  for (const x of e) x.run = varints(b, st);
  for (const x of e) x.len = varints(b, st);
  let prev = 0;
  for (const x of e) {
    const o = varints(b, st);
    x.off = o === 0 ? prev : o - 1;
    prev = x.off + x.len;
  }
  return e;
}

function* entries(off, len) {
  for (const e of readDir(off, len)) {
    if (e.run === 0) yield* entries(h.leafOff + e.off, e.len);
    else yield e;
  }
}

// Índice Hilbert de PMTiles -> z/x/y.
function idToZxy(idIn) {
  let acc = 0;
  for (let z = 0; z < 32; z++) {
    const n = 4 ** z;
    if (idIn < acc + n) {
      let t = idIn - acc;
      let x = 0;
      let y = 0;
      for (let s = 1; s < 2 ** z; s *= 2) {
        const rx = 1 & (t / 2);
        const ry = 1 & (t ^ rx);
        if (ry === 0) {
          if (rx === 1) {
            x = s - 1 - x;
            y = s - 1 - y;
          }
          [x, y] = [y, x];
        }
        x += s * rx;
        y += s * ry;
        t = Math.floor(t / 4);
      }
      return [z, x, y];
    }
    acc += n;
  }
  throw new Error("id fuera de rango");
}

// Decodificador mínimo de Mapbox Vector Tile (solo capas, claves y tags).
function pbf(b, fn) {
  const st = { p: 0 };
  while (st.p < b.length) {
    const key = varints(b, st);
    const f = key >>> 3;
    const w = key & 7;
    if (w === 0) fn(f, varints(b, st), null);
    else if (w === 2) {
      const l = varints(b, st);
      fn(f, null, b.subarray(st.p, st.p + l));
      st.p += l;
    } else if (w === 1) st.p += 8;
    else if (w === 5) st.p += 4;
    else throw new Error("wire type " + w);
  }
}

function decodeTile(b, onFeature) {
  pbf(b, (f, _v, sub) => {
    if (f !== 3) return;
    let name = "";
    const keys = [];
    const values = [];
    const feats = [];
    pbf(sub, (lf, _lv, ls) => {
      if (lf === 1) name = ls.toString("utf8");
      else if (lf === 3) keys.push(ls.toString("utf8"));
      else if (lf === 4) {
        let val;
        pbf(ls, (vf, vv, vs) => {
          if (vf === 1) val = vs.toString("utf8");
          else if (vf === 2) val = vs.readFloatLE(0);
          else if (vf === 3) val = vs.readDoubleLE(0);
          else if (vf === 6)
            val = (vv >>> 1) ^ -(vv & 1); // sint_value (zigzag): Planetiler codifica así los enteros
          else val = vv;
        });
        values.push(val);
      } else if (lf === 2) feats.push(ls);
    });
    for (const fb of feats) {
      const tags = [];
      let type = 0;
      let rings = 0;
      pbf(fb, (ff, fv, fs) => {
        if (ff === 2 && fs) {
          const st = { p: 0 };
          while (st.p < fs.length) tags.push(varints(fs, st));
        } else if (ff === 3) type = fv;
        else if (ff === 4 && fs) {
          // Geometría: cuenta MoveTo (cada anillo/parte de un multipolígono empieza con uno).
          const st = { p: 0 };
          while (st.p < fs.length) {
            const c = varints(fs, st);
            const id = c & 7;
            const n = c >>> 3;
            if (id === 1) rings += n;
            if (id !== 7) for (let k = 0; k < n * 2; k++) varints(fs, st);
          }
        }
      });
      const attrs = new Map();
      for (let i = 0; i < tags.length; i += 2) attrs.set(keys[tags[i]], values[tags[i + 1]]);
      onFeature(name, type, attrs, rings);
    }
  });
}

const DEFAULT_HEIGHT = 5;
const meta = JSON.parse(
  unz(buf.subarray(h.metaOff, h.metaOff + h.metaLen), h.internalComp).toString("utf8"),
);
const layerCount = {};
const attrsByLayer = {};
const z14 = { tiles: 0, features: 0, rings: 0, withHeight: 0, ringsWithHeight: 0, ringsRaised: 0 };
const heights = new Map();
let lastZ = -1;
const zooms = new Set();

for (const e of entries(h.rootOff, h.rootLen)) {
  for (let i = 0; i < Math.max(1, e.run); i++) {
    const [z] = idToZxy(e.id + i);
    zooms.add(z);
  }
  const [z] = idToZxy(e.id);
  if (z !== h.maxZ) continue; // recuento de edificios solo en el zoom máximo (sin duplicados entre zooms)
  const tile = unz(buf.subarray(h.dataOff + e.off, h.dataOff + e.off + e.len), h.tileComp);
  z14.tiles++;
  decodeTile(tile, (layer, _type, attrs, rings) => {
    layerCount[layer] = (layerCount[layer] ?? 0) + 1;
    const a = (attrsByLayer[layer] ??= new Set());
    attrs.forEach((_v, k) => a.add(k));
    if (layer === "building") {
      z14.features++;
      z14.rings += rings;
      const hgt = attrs.get("render_height");
      if (hgt !== undefined) {
        z14.withHeight++;
        z14.ringsWithHeight += rings;
        heights.set(hgt, (heights.get(hgt) ?? 0) + rings);
      }
      if (attrs.get("render_min_height") > 0) z14.ringsRaised += rings;
    }
  });
}

const mb = size / 1024 / 1024;
console.log(`Fichero:    ${file}`);
console.log(`Tamaño:     ${mb.toFixed(2)} MB (límite ${maxMb} MB)`);
console.log(
  `Zooms:      ${h.minZ}-${h.maxZ} (presentes: ${[...zooms].sort((a, b) => a - b).join(",")})`,
);
console.log(`Bbox:       ${h.bbox.map((n) => n.toFixed(4)).join(", ")}`);
console.log(`Tiles:      ${h.tiles} direccionados; ${z14.tiles} en z${h.maxZ}`);
console.log(`Esquema:    ${meta.name ?? "?"} / ${meta.version ?? "?"} / ${meta.format ?? "pbf"}`);
console.log(`Capas (metadatos): ${(meta.vector_layers ?? []).map((l) => l.id).join(", ")}`);
console.log(`Capas en z${h.maxZ} (nº de features, con duplicados entre teselas):`);
for (const [l, n] of Object.entries(layerCount).sort()) {
  console.log(
    `  ${l.padEnd(18)} ${String(n).padStart(5)}  attrs: ${[...attrsByLayer[l]].sort().join(", ")}`,
  );
}
const top = [...heights.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);
console.log(
  `Edificios z${h.maxZ}: ${z14.features} features (multipolígonos agrupados por atributos), ~${z14.rings} polígonos/anillos (cuenta con duplicados en bordes de tesela y huecos)`,
);
console.log(
  `  con render_height: ${z14.ringsWithHeight} (${((100 * z14.ringsWithHeight) / Math.max(1, z14.rings)).toFixed(1)} %); con render_min_height > 0: ${z14.ringsRaised}`,
);
console.log(
  `  alturas más frecuentes (m: anillos): ${top.map(([k, v]) => `${k}: ${v}`).join(", ")}`,
);
// OpenMapTiles pone render_height = 5 m cuando OSM no trae height ni building:levels.
const byDefault = heights.get(DEFAULT_HEIGHT) ?? 0;
console.log(
  `  altura por defecto (${DEFAULT_HEIGHT} m, no real): ${byDefault} anillos (${((100 * byDefault) / Math.max(1, z14.ringsWithHeight)).toFixed(1)} %); resto ≈ real: ${((100 * (z14.ringsWithHeight - byDefault)) / Math.max(1, z14.ringsWithHeight)).toFixed(1)} %`,
);

const required = [
  "building",
  "water",
  "waterway",
  "landcover",
  "landuse",
  "park",
  "transportation",
  "transportation_name",
  "place",
  "boundary",
];
for (const l of required) if (!layerCount[l]) fail.push(`falta la capa ${l}`);
if (mb > maxMb) fail.push(`tamaño ${mb.toFixed(2)} MB > ${maxMb} MB`);
if (z14.withHeight === 0) fail.push("ningún edificio con render_height");
if (h.tileType !== 1) fail.push("tile type no es MVT");

if (fail.length) {
  console.error("\nFALLO:\n- " + fail.join("\n- "));
  process.exit(1);
}
console.log("\nOK");
