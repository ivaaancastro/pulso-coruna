import "./styles/tokens.css";
import "./styles/shell.css";
import { createClock } from "./components/clock";
import { createModeSelector } from "./components/mode-selector";
import { createPulseIndex } from "./components/pulse-index";
import { createTranslator, detectLocale } from "./i18n";

const locale = detectLocale(window.location.search, navigator.languages);
const t = createTranslator(locale);

document.documentElement.lang = locale;
document.title = t("app.name");

const app = document.getElementById("app");
if (!app) throw new Error("Falta #app en index.html");

// Contenedor del mapa: vacío hasta M2.2.
const map = document.createElement("div");
map.id = "map";
map.setAttribute("role", "img");
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

app.append(map, shell);
clock.start();

// PWA: solo en build de producción y en carga diferida (no suma al JS inicial).
if (import.meta.env.PROD) {
  void import("./pwa/register").then((m) => m.registerServiceWorker(t));
}
