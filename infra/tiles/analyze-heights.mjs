#!/usr/bin/env node
// Análisis (no genera teselas): cuántos edificios OSM tienen altura real y cuántos podría
// completar el Catastro INSPIRE (BuildingPart.numberOfFloorsAboveGround) por intersección espacial.
// Entradas: infra/tiles/.work/osm-buildings.tsv (volcado con infra/tiles/DumpBuildings.java, ver docs/sources/catastro-edificios.md)
//           infra/tiles/.work/catastro/<muni>.zip (infra/tiles/fetch-catastro.mjs)
// Uso: node infra/tiles/analyze-heights.mjs
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const work = join(dirname(fileURLToPath(import.meta.url)), ".work");
const BBOX = [-8.58, 43.27, -8.25, 43.45];

// --- UTM 29N (EPSG:25829, ETRS89 ~ WGS84 a este nivel) -> lon/lat -------------------------
function utm29ToLonLat(E, N) {
  const a = 6378137,
    f = 1 / 298.257222101,
    k0 = 0.9996,
    lon0 = (-9 * Math.PI) / 180;
  const e2 = f * (2 - f),
    ep2 = e2 / (1 - e2);
  const x = E - 500000,
    M = N / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);
  const s = Math.sin(phi1),
    c = Math.cos(phi1),
    t = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * s * s),
    T1 = t * t,
    C1 = ep2 * c * c;
  const R1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5,
    D = x / (N1 * k0);
  const lat =
    phi1 -
    ((N1 * t) / R1) *
      (D ** 2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6) / 720);
  const lon =
    lon0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5) / 120) /
      c;
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

// --- geometría -----------------------------------------------------------------------------
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function centroid(ring) {
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    const w = xj * yi - xi * yj;
    a += w;
    cx += (xj + xi) * w;
    cy += (yj + yi) * w;
  }
  return a === 0 ? ring[0] : [cx / (3 * a), cy / (3 * a)];
}
const bboxOf = (ring) => {
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};
const M_LAT = 111320,
  M_LON = 111320 * Math.cos((43.36 * Math.PI) / 180);
const areaM2 = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j][0] * M_LON * (ring[i][1] * M_LAT) - ring[i][0] * M_LON * (ring[j][1] * M_LAT);
  return Math.abs(a) / 2;
};

// --- OSM -----------------------------------------------------------------------------------
const osm = readFileSync(join(work, "osm-buildings.tsv"), "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((l) => {
    const [id, kind, height, levels, minh, area, lon, lat, ring] = l.split("\t");
    const r = ring
      .split(",")
      .filter(Boolean)
      .map((p) => p.split(" ").map(Number));
    return { id, kind, height, levels, hasReal: !!(height || levels), ring: r, bb: bboxOf(r) };
  });
const buildings = osm.filter((o) => o.kind === "building");
const parts = osm.filter((o) => o.kind === "part");

// índice en rejilla de ~100 m
const CELL = 0.001;
const grid = new Map();
const key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
buildings.forEach((b, i) => {
  for (let cx = Math.floor(b.bb[0] / CELL); cx <= Math.floor(b.bb[2] / CELL); cx++)
    for (let cy = Math.floor(b.bb[1] / CELL); cy <= Math.floor(b.bb[3] / CELL); cy++) {
      const k = `${cx},${cy}`;
      (grid.get(k) ?? grid.set(k, []).get(k)).push(i);
    }
});
const findBuilding = (x, y) => {
  for (const i of grid.get(key(x, y)) ?? []) {
    const b = buildings[i];
    if (x >= b.bb[0] && x <= b.bb[2] && y >= b.bb[1] && y <= b.bb[3] && inRing(x, y, b.ring))
      return i;
  }
  return -1;
};

// OSM building con partes OSM dentro (OMT oculta el contorno y extruye las partes)
const hasOsmPart = new Uint8Array(buildings.length);
for (const p of parts) {
  const [x, y] = centroid(p.ring);
  const i = findBuilding(x, y);
  if (i >= 0) hasOsmPart[i] = 1;
}

// --- Catastro: BuildingPart -------------------------------------------------------------------
const floorsByBuilding = buildings.map(() => []); // [{floors, area}]
let catParts = 0,
  catNoFloors = 0,
  catInBbox = 0;
for (const muni of ["15900", "15059", "15005", "15076", "15008", "15031", "15017", "15001"]) {
  const zip = join(work, "catastro", `${muni}.zip`);
  if (!existsSync(zip)) continue;
  const proc = spawn("unzip", ["-p", zip, `A.ES.SDGC.BU.${muni}.buildingpart.gml`]);
  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
  let cur = null;
  for await (const line of rl) {
    if (line.includes("<bu-ext2d:BuildingPart ")) cur = { floors: null, ring: null };
    else if (cur) {
      let m;
      if ((m = line.match(/numberOfFloorsAboveGround[^>]*>(\d+)</))) cur.floors = Number(m[1]);
      else if (!cur.ring && (m = line.match(/<gml:posList[^>]*>([^<]+)</))) {
        const n = m[1].trim().split(/\s+/).map(Number);
        const ring = [];
        for (let i = 0; i + 1 < n.length; i += 2) ring.push(utm29ToLonLat(n[i], n[i + 1]));
        cur.ring = ring;
      } else if (line.includes("</bu-ext2d:BuildingPart>")) {
        catParts++;
        const [x, y] = centroid(cur.ring);
        if (x >= BBOX[0] && x <= BBOX[2] && y >= BBOX[1] && y <= BBOX[3]) {
          catInBbox++;
          if (cur.floors == null) catNoFloors++;
          else {
            const i = findBuilding(x, y);
            if (i >= 0 && cur.floors > 0)
              floorsByBuilding[i].push({ floors: cur.floors, area: areaM2(cur.ring) });
          }
        }
        cur = null;
      }
    }
  }
}

// --- informe -------------------------------------------------------------------------------------
const pct = (a, b) => `${((100 * a) / b).toFixed(1)} %`;
const nB = buildings.length;
const real = buildings.filter((b) => b.hasReal).length;
const withPartOnly = buildings.filter((b, i) => !b.hasReal && hasOsmPart[i]).length;
console.log(
  `OSM bbox ${BBOX.join(",")}: ${nB} edificios (building=*), ${parts.length} partes (building:part=*)`,
);
console.log(
  `  altura real propia (height|building:levels): ${real} (${pct(real, nB)}); solo height: ${buildings.filter((b) => b.height).length}`,
);
console.log(
  `  sin tag de altura/plantas: ${nB - real} (${pct(nB - real, nB)}), de ellos con partes OSM dentro (cubiertos por las partes): ${withPartOnly}`,
);
const partsReal = parts.filter((p) => p.hasReal).length;
console.log(`  partes OSM con altura real: ${partsReal} (${pct(partsReal, parts.length)})`);
console.log(
  `Catastro: ${catParts} BuildingPart totales (8 municipios), ${catInBbox} en bbox, sin plantas: ${catNoFloors}`,
);
const matched = buildings.map((_, i) => floorsByBuilding[i].length > 0);
const noReal = buildings.map((b, i) => !b.hasReal && !hasOsmPart[i]);
const gain = noReal.filter((v, i) => v && matched[i]).length;
const totalNoReal = noReal.filter(Boolean).length;
console.log(
  `Edificios OSM sin altura real ni partes: ${totalNoReal}; con partes Catastro que los intersecan: ${gain} (${pct(gain, totalNoReal)})`,
);
const afterReal = real + withPartOnly + gain;
console.log(
  `Cobertura real: antes ${pct(real + withPartOnly, nB)} -> después ${pct(afterReal, nB)} (+${gain})`,
);
// acuerdo OSM levels vs Catastro (máx plantas)
const diffs = new Map();
let cmp = 0;
buildings.forEach((b, i) => {
  if (b.levels && !b.height && matched[i]) {
    const lv = parseFloat(b.levels);
    if (Number.isNaN(lv)) return;
    const cf = Math.max(...floorsByBuilding[i].map((f) => f.floors));
    const d = Math.max(-4, Math.min(4, Math.round(cf - lv)));
    diffs.set(d, (diffs.get(d) ?? 0) + 1);
    cmp++;
  }
});
console.log(
  `Acuerdo building:levels (OSM) vs máx plantas Catastro, ${cmp} edificios (dif = catastro - osm, recortado a ±4):`,
);
for (const d of [...diffs.keys()].sort((a, b) => a - b))
  console.log(`  ${d >= 0 ? "+" : ""}${d}: ${diffs.get(d)} (${pct(diffs.get(d), cmp)})`);

// desglose por zona (bbox aproximado del término de A Coruña)
const [zx0, zy0, zx1, zy1] = [-8.47, 43.31, -8.36, 43.4];
const inCity = (b) => {
  const [x, y] = centroid(b.ring);
  return x >= zx0 && x <= zx1 && y >= zy0 && y <= zy1;
};
for (const [name, sel] of [
  ["A Coruña (bbox aprox.)", inCity],
  ["Resto del bbox", (b) => !inCity(b)],
]) {
  const idx = buildings.map((_, i) => i).filter((i) => sel(buildings[i]));
  const r = idx.filter((i) => buildings[i].hasReal || hasOsmPart[i]).length;
  const g = idx.filter((i) => noReal[i] && matched[i]).length;
  console.log(
    `${name}: ${idx.length} edificios; real ${r} (${pct(r, idx.length)}) -> con Catastro ${r + g} (${pct(r + g, idx.length)})`,
  );
}
