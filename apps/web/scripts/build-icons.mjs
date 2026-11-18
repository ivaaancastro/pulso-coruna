/* global URL, console */
// Genera los PNG de la PWA desde icons/icon.svg. Uso: pnpm --filter @pulso/web icons
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile(new URL("../icons/icon.svg", import.meta.url));
const out = (name) => new URL(`../public/${name}`, import.meta.url);
const targets = [
  ["icons/icon-192.png", 192],
  ["icons/icon-512.png", 512],
  // Mismo motivo: cae dentro de la zona segura (círculo del 80 %) y el fondo llega al borde.
  ["icons/icon-maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
];
for (const [name, size] of targets) {
  const png = await sharp(svg, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(out(name), png);
  console.log(name, png.length, "B");
}
await writeFile(out("favicon.svg"), svg);
