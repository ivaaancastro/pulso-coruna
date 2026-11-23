/* global URL, console, process, document */
// Genera public/og.png (1200×630), la imagen Open Graph ESTÁTICA de marca (M8.5): fondo de la dirección de
// arte (docs/design/direccion.md) y estelas de luz abstractas; sin cifras ni texto de datos (el estado real
// va en la meta description de /api/v1/share). Uso: pnpm --filter @pulso/web og
// Necesita el Chromium de Playwright (`pnpm exec playwright install chromium`), ya devDependency de la raíz.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const font = await readFile(
  new URL("../public/fonts/archivo-latin-wdth-normal.woff2", import.meta.url),
);

const trail = (d, color, w, o) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${o}" stroke-width="${w}" stroke-linecap="round"/>`;
const dot = (x, y, color) =>
  `<circle cx="${x}" cy="${y}" r="9" fill="${color}" fill-opacity="0.25"/><circle cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b2236"/><stop offset="1" stop-color="#06131f"/>
    </linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#f5f1e4" stop-opacity="0.5"/><stop offset="1" stop-color="#f5f1e4" stop-opacity="0"/></radialGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f5f1e4" stop-opacity="0.35"/><stop offset="1" stop-color="#f5f1e4" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="#05080e"/>
  <rect y="360" width="1200" height="270" fill="url(#sea)"/>
  <path d="M0 360H1200" stroke="#1e3a55" stroke-width="2"/>
  <!-- península y Torre de Hércules, en silueta -->
  <path d="M0 360 L0 340 Q120 332 200 346 Q260 352 330 340 L380 360Z" fill="#0a0f19"/>
  <path d="M905 360 L915 262 H941 L951 360Z" fill="#141c2e" stroke="#5a6a88" stroke-width="2"/>
  <rect x="911" y="248" width="34" height="16" rx="2" fill="#141c2e" stroke="#5a6a88" stroke-width="2"/>
  <path d="M928 240 L1200 170 V300Z" fill="url(#beam)"/>
  <circle cx="928" cy="240" r="70" fill="url(#glow)"/><circle cx="928" cy="240" r="9" fill="#f5f1e4"/>
  <!-- estelas de luz abstractas (decoración, no datos) -->
  ${trail("M40 470 C220 440 360 500 560 462", "#22c7d9", 3, 0.5)}
  ${trail("M120 520 C300 500 420 548 640 520", "#22c7d9", 2.5, 0.35)}
  ${trail("M690 430 C780 440 840 480 960 470", "#ff7a59", 3, 0.6)}
  ${trail("M520 220 C600 190 680 215 780 200", "#ffc23d", 3, 0.7)}
  ${trail("M520 330 C580 310 640 332 700 318", "#6be8a4", 3, 0.7)}
  ${trail("M980 90 C1040 100 1100 120 1160 150", "#f5f1e4", 2, 0.5)}
  ${dot(780, 200, "#ffc23d")}${dot(700, 318, "#6be8a4")}${dot(960, 470, "#ff7a59")}${dot(560, 462, "#22c7d9")}${dot(1160, 150, "#f5f1e4")}
  <!-- pulso -->
  <path d="M60 560 H300 L330 520 L362 596 L396 540 L418 560 H700" fill="none" stroke="#f5f1e4" stroke-opacity="0.85" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
  <text x="60" y="200" font-family="Archivo" font-weight="300" font-stretch="125%" font-size="108" fill="#e8eef7" letter-spacing="-1">Pulso</text>
  <text x="60" y="296" font-family="Archivo" font-weight="500" font-stretch="105%" font-size="84" fill="#e8eef7">A Coruña</text>
</svg>`;

const html = `<!doctype html><style>
@font-face{font-family:"Archivo";src:url(data:font/woff2;base64,${font.toString("base64")}) format("woff2");font-weight:300 600;font-stretch:90% 125%}
html,body{margin:0;background:#05080e}</style>${svg}`;

// CHROMIUM_PATH: ejecutable alternativo si no está el Chromium que espera esta versión de Playwright.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({
    type: "png",
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
  await writeFile(new URL("../public/og.png", import.meta.url), png);
  console.log("og.png", png.length, "B");
} finally {
  await browser.close();
}
