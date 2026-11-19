import "./styles/tokens.css";
import "./styles/shell.css";
import { createClock } from "./components/clock";
import { createModeSelector } from "./components/mode-selector";
import { createPulseIndex } from "./components/pulse-index";
import { createTranslator, detectLocale } from "./i18n";
import type { LiveHandle } from "./live/start";
import type { ReplayController } from "./replay/controller";
import type { PulsoMap } from "./map/map";
import { createBaseNow, createNow, parseTimeOverride } from "./time/now";

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

// Modo Reproducir (M6.3): chunk diferido; se carga la primera vez que se elige. Cambiar de modo no
// recarga la escena: solo cambia de dónde leen las capas y qué hora usan (ver `replay/controller.ts`).
let replay: Promise<ReplayController | null> | null = null;
let pulsoMap: PulsoMap | null = null;
let settleLive: (handle: LiveHandle | null) => void = () => undefined;
const liveReady = new Promise<LiveHandle | null>((resolve) => (settleLive = resolve));

function loadReplay(): Promise<ReplayController | null> {
  replay ??= Promise.all([import("./replay/start"), liveReady])
    .then(([m, live]) =>
      live
        ? m.startReplay({
            live,
            baseNow: createBaseNow(window.location.search),
            showTime: (ms) => clock.render(ms),
            refreshPalette: () => pulsoMap?.refreshPalette(),
            host: bottom,
            before: modes.element,
            search: window.location.search,
          })
        : null,
    )
    .catch((error: unknown) => {
      console.error("[replay] no se pudo iniciar", error);
      replay = null;
      return null;
    });
  return replay;
}

const modes = createModeSelector(t, (mode) => {
  void (async () => {
    if (mode === "replay") {
      const controller = await loadReplay();
      if (modes.getMode() !== "replay") return; // el usuario ya cambió de modo mientras cargaba
      try {
        controller?.enter();
      } catch (error) {
        console.error("[replay] no se pudo entrar", error);
        controller?.exit();
        replay = null;
        modes.select("view");
        modes.status.textContent = t("replay.unavailable");
        return;
      }
      if (!controller) {
        modes.select("view");
        modes.status.textContent = t("replay.unavailable");
      }
    } else if (replay) {
      (await replay)?.exit();
    }
  })();
});

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
    pulsoMap = createPulsoMap({
      container: map,
      now,
      fixedTime: import.meta.env.DEV && parseTimeOverride(window.location.search) !== null,
      // Datos en vivo (worker + deck.gl) tras el primer fotograma, para no competir con la carga.
      onFirstFrame: () => {
        const target = pulsoMap?.map;
        if (!target) return;
        void import("./live/start")
          .then((m) => m.startLive({ map: target, now, search: window.location.search }))
          .then(settleLive)
          .catch((error: unknown) => {
            console.error("[live] no se pudo iniciar", error);
            settleLive(null);
          });
      },
    });
  })
  .catch((error: unknown) => {
    console.error("[map] no se pudo iniciar", error);
    map.setAttribute("aria-label", t("map.unavailable"));
    settleLive(null);
  });

// PWA: solo en build de producción y en carga diferida (no suma al JS inicial).
if (import.meta.env.PROD) {
  void import("./pwa/register").then((m) => m.registerServiceWorker(t));
}
