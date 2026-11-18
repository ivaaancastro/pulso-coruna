#!/usr/bin/env node
// Descarga los ZIP INSPIRE de Edificios del Catastro (servicio ATOM, descarga anónima) de los
// municipios que cubre el bbox de las teselas. Una petición por municipio, con pausa.
// Uso: node --use-system-ca infra/tiles/fetch-catastro.mjs [directorio]
// (--use-system-ca: el servidor www.catastro.hacienda.gob.es no envía el certificado intermedio
//  de FNMT y Node necesita el almacén del sistema; no se desactiva nunca la verificación TLS.)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? join(here, ".work", "catastro");
const BASE = "https://www.catastro.hacienda.gob.es/INSPIRE/Buildings/15/";
// [carpeta en el servidor (la Ñ va en latin-1), código INE-Catastro]
const MUNICIPIOS = [
  ["15900-A%20CORU%D1A", "15900"],
  ["15059-OLEIROS", "15059"],
  ["15005-ARTEIXO", "15005"],
  ["15076-SADA", "15076"],
  ["15008-BERGONDO", "15008"],
  ["15031-CULLEREDO", "15031"],
  ["15017-CAMBRE", "15017"],
  ["15001-ABEGONDO", "15001"],
];

mkdirSync(outDir, { recursive: true });
for (const [dir, code] of MUNICIPIOS) {
  const file = join(outDir, `${code}.zip`);
  if (existsSync(file)) {
    console.log(`${code}: ya descargado`);
    continue;
  }
  const res = await fetch(`${BASE}${dir}/A.ES.SDGC.BU.${code}.zip`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; pulso-tiles)" },
  });
  if (!res.ok) throw new Error(`${code}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  console.log(
    `${code}: ${(buf.length / 1e6).toFixed(1)} MB (Last-Modified ${res.headers.get("last-modified")})`,
  );
  await new Promise((r) => setTimeout(r, 2000));
}
