import "./styles/tokens.css";
import "./styles/shell.css";
import { createClock } from "./components/clock";
import { createModeSelector } from "./components/mode-selector";
import { createPulseIndex } from "./components/pulse-index";
import { createTranslator, detectLocale } from "./i18n";
import { createNow, parseTimeOverride } from "./time/now";

const locale = detectLocale(window.location.search, navigator.languages);
const t = createTranslator(locale);

document.documentElement.lang = locale;
document.title = t("app.name");

const app = document.getElementById("app");
if (!app) throw new Error("Falta #app en index.html");

const now = createNow(window.location.search);

// Contenedor del mapa. MapLibre se carga en un chunk aparte (import dinámico) para no pesar
// en el JS inicial; el shell se pinta antes que el mapa.
const map = document.createElement("div");
map.id = "map";
map.setAttribute("role", "region");
map.setAttribute("aria-label", t("map.label"));

const clock = createClock(t, locale);
const pulse = createPulseIndex(t);
const modes = createModeSelector(t);

const top = document.createElement("header");
top.className = "shell__top";
top.append(clock.element, pulse);

const bottom = document.createElement("div");
bottom.className = "shell__bottom";
bottom.append(modes.element, modes.status);

const shell = document.createElement("main");
shell.className = "shell";
shell.append(top, bottom);

// Velo superior: funde el mar con el fondo hacia el horizonte (el color lo fija el mapa según la luz).
const veil = document.createElement("div");
veil.className = "map-veil";
veil.setAttribute("aria-hidden", "true");

app.append(map, veil, shell);
clock.start(now);

import("./map/map")
  .then(({ createPulsoMap }) => {
    createPulsoMap({
      container: map,
      now,
      fixedTime: import.meta.env.DEV && parseTimeOverride(window.location.search) !== null,
    });
  })
  .catch((error: unknown) => {
    console.error("[map] no se pudo iniciar", error);
    map.setAttribute("aria-label", t("map.unavailable"));
  });

// PWA: solo en build de producción y en carga diferida (no suma al JS inicial).
if (import.meta.env.PROD) {
  void import("./pwa/register").then((m) => m.registerServiceWorker(t));
}
