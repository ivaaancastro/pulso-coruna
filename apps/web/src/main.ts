import "./styles/tokens.css";
import "./styles/shell.css";
import type { AudioContextLike } from "./audio/context";
import type { AudioHandle } from "./audio/start";
import { createClock } from "./components/clock";
import { createLanguageSelector } from "./components/language-selector";
import type { Mode, ModeSelector } from "./components/mode-selector";
import type { PulseIndex } from "./components/pulse-index";
import { features } from "./features";
import { createTranslator, DEFAULT_LOCALE, detectLocale, readSessionLocale } from "./i18n";
import { resolvePulseUrl, resolveStreamUrl } from "./live/config";
import type { LiveHandle } from "./live/start";
import type { ReplayController, ReplayState } from "./replay/controller";
import type { PulsoMap } from "./map/map";
import type { ShareState } from "./share/url-state";
import { createCreditsLink } from "./status/link";
import { createBaseNow, createNow, parseTimeOverride } from "./time/now";

const locale = detectLocale(
  window.location.search,
  navigator.languages,
  readSessionLocale(() => window.sessionStorage),
);
const t = createTranslator(locale);

// Metadatos según el idioma (index.html trae los de es). El manifiesto lo lee el navegador al
// instalar: cada idioma tiene el suyo (`manifest.<lang>.webmanifest`).
document.documentElement.lang = locale;
document.title = t("app.name");
document.querySelector('meta[name="description"]')?.setAttribute("content", t("app.description"));
if (locale !== DEFAULT_LOCALE) {
  document
    .querySelector('link[rel="manifest"]')
    ?.setAttribute("href", `/manifest.${locale}.webmanifest`);
}

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

// v1 simple: Escuchar, Reproducir, Pulso, clip y compartir son flags (`features.ts`). Apagados no se
// importa ni se monta nada de ellos. La cámara en el hash sigue activa (desacoplada de Reproducir).

const streamUrl = resolveStreamUrl(
  { dev: import.meta.env.DEV, configured: import.meta.env.VITE_LIVE_URL as string | undefined },
  window.location.search,
  window.location,
);

const top = document.createElement("header");
top.className = "shell__top";
top.append(clock.element);

// Modo Reproducir (M6.3): chunk diferido; se carga la primera vez que se elige. Cambiar de modo no
// recarga la escena: solo cambia de dónde leen las capas y qué hora usan (ver `replay/controller.ts`).
let replay: Promise<ReplayController | null> | null = null;
let replayController: ReplayController | null = null;
let pulsoMap: PulsoMap | null = null;
let settleLive: (handle: LiveHandle | null) => void = () => undefined;
const liveReady = new Promise<LiveHandle | null>((resolve) => (settleLive = resolve));
let liveHandle: LiveHandle | null = null;
void liveReady.then((handle) => (liveHandle = handle));

// Selector de modos / Escuchar: solo existe si hay algo más que «Ahora» (chunk diferido).
let modes: ModeSelector | null = null;
let settleModes: () => void = () => undefined;
const modesReady = new Promise<void>((resolve) => (settleModes = resolve));
if (!features.replay && !features.listen) settleModes();

const getMode = (): Mode => modes?.getMode() ?? "view";

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
            before: modes?.element ?? null,
            search: window.location.search,
          })
        : null,
    )
    .then((controller) => (replayController = controller))
    .catch((error: unknown) => {
      console.error("[replay] no se pudo iniciar", error);
      replay = null;
      return null;
    });
  return replay;
}

// URL compartible (M6.4): el módulo es un chunk diferido y solo se descarga si hay hash (el estado
// se lee antes de crear el mapa para nacer ya en la cámara del enlace) o tras el primer fotograma.
// Sin Reproducir, del enlace solo cuenta la cámara.
const sharedState: Promise<ShareState | null> =
  window.location.hash.length > 1
    ? import("./share/url-state")
        .then((m) => {
          const state = m.parseShareHash(
            window.location.hash,
            createBaseNow(window.location.search)(),
          );
          if (!state || features.replay) return state;
          return state.camera ? { mode: "view" as const, camera: state.camera } : null;
        })
        .catch(() => null)
    : Promise.resolve(null);

/** Estado del enlace que `modes.select("replay")` debe aplicar al entrar (así no se pide antes «hace 1 h»). */
let pendingReplayState: Partial<ReplayState> | null = null;

/** Abre Reproducir en el instante y la velocidad del enlace; en pausa salvo que pida `p=1`. */
async function restoreReplay(state: ShareState): Promise<void> {
  await modesReady;
  pendingReplayState = {
    mode: "replay",
    ...(state.t !== undefined ? { t: state.t } : {}),
    ...(state.speed !== undefined ? { speed: state.speed } : {}),
    playing: state.play === true,
  };
  // La entrada real la hace la continuación de `modes.select` (mismo `loadReplay()`), con ese estado.
  if (!modes?.select("replay")) pendingReplayState = null;
}

// Escuchar (M7.1): interruptor independiente del modo. El AudioContext se crea dentro del gesto del
// clic (política de autoplay, iOS); el motor es un chunk diferido que solo se descarga al activarlo.
let audio: Promise<AudioHandle | null> | null = null;

function toggleAudio(
  on: boolean,
  createUserContext: () => AudioContextLike | null,
): boolean | Promise<boolean> {
  if (!on) {
    const running = audio;
    audio = null;
    void running?.then((handle) => handle?.stop());
    return true;
  }
  const ctx = createUserContext();
  if (!ctx) return false;
  audio = Promise.all([import("./audio/start"), liveReady])
    .then(([m, live]) =>
      live
        ? m.startAudio({
            ctx,
            store: live.view,
            // Reproducir en pausa: solo las capas continuas (mar y viento).
            transientsEnabled: () =>
              getMode() !== "replay" || (replayController?.getState().playing ?? true),
          })
        : null,
    )
    .catch((error: unknown) => {
      console.error("[audio] no se pudo iniciar", error);
      return null;
    });
  return audio.then((handle) => {
    if (!handle) void ctx.close().catch(() => undefined);
    return handle !== null;
  });
}

function onModeChange(mode: Mode): void {
  void (async () => {
    if (mode === "replay") {
      const controller = await loadReplay();
      const pending = pendingReplayState;
      pendingReplayState = null;
      if (getMode() !== "replay") return; // el usuario ya cambió de modo mientras cargaba
      try {
        if (pending) controller?.applyState(pending);
        else controller?.enter();
      } catch (error) {
        console.error("[replay] no se pudo entrar", error);
        controller?.exit();
        replay = null;
        modes?.select("view");
        if (modes) modes.status.textContent = t("replay.unavailable");
        return;
      }
      if (!controller) {
        modes?.select("view");
        if (modes) modes.status.textContent = t("replay.unavailable");
      }
    } else if (replay) {
      (await replay)?.exit();
    }
  })();
}

// Estado y créditos (M8.4): el panel abre con los créditos al instante; el estado es un chunk diferido.
const creditsLink = createCreditsLink({ t, locale, streamUrl });

const bottom = document.createElement("div");
bottom.className = "shell__bottom";
bottom.append(creditsLink);

// UI de las funciones con flag: un único chunk diferido, solo si hay alguna activa.
const featuresUi =
  features.replay || features.listen || features.pulse ? import("./features-ui") : null;

if (featuresUi && (features.replay || features.listen)) {
  void featuresUi
    .then((ui) => {
      modes = ui.createModeSelector(
        t,
        onModeChange,
        (on) => toggleAudio(on, ui.createUserContext),
        { modes: features.replay, listen: features.listen },
      );
      bottom.prepend(modes.element, modes.status);
    })
    .catch((error: unknown) => console.error("[modes] no se pudo iniciar", error))
    .finally(settleModes);
}

const shell = document.createElement("main");
shell.className = "shell";
const languageSelector = createLanguageSelector({ t, locale });
shell.append(top, languageSelector, bottom);

// Velo superior: funde el mar con el fondo hacia el horizonte (el color lo fija el mapa según la luz).
const veil = document.createElement("div");
veil.className = "map-veil";
veil.setAttribute("aria-hidden", "true");

app.append(map, veil, shell);
clock.start(now);

// Índice Pulso (M7.3): la vista y el cliente son chunks diferidos. Solo habla con nuestra API
// (`/api/v1/pulse`, derivada de la misma configuración que el stream).
if (featuresUi && features.pulse) {
  const pulseUrl = streamUrl ? resolvePulseUrl(streamUrl) : null;
  void featuresUi.then((ui) => {
    const pulse: PulseIndex = ui.createPulseIndex(t);
    top.append(pulse.element);
    if (pulseUrl) {
      void import("./pulse/start")
        .then((m) => m.startPulse({ url: pulseUrl, now, view: pulse }))
        .catch((error: unknown) => {
          console.error("[pulse] no se pudo iniciar", error);
          pulse.render(ui.deriveSnapshot(null, "error", now()));
        });
    } else {
      pulse.render(ui.deriveSnapshot(null, "nodata", now()));
    }

    // Clip vertical (M8.5): depende del índice (lo pone en su cuadro). El motor es otro chunk.
    if (features.clip) {
      const clip = ui.createClipButton({
        t,
        context: () =>
          pulsoMap
            ? {
                map: pulsoMap.map,
                deck: liveHandle?.deck ?? null,
                t,
                locale,
                now,
                index: pulse.current,
              }
            : null,
      });
      languageSelector.after(clip.element);
    }
  });
}

Promise.all([import("./map/map"), sharedState])
  .then(([{ createPulsoMap }, shared]) => {
    const cam = shared?.camera;
    pulsoMap = createPulsoMap({
      container: map,
      now,
      ...(cam
        ? {
            camera: {
              center: [cam.lon, cam.lat] as [number, number],
              zoom: cam.zoom,
              pitch: cam.pitch,
              bearing: cam.bearing,
            },
          }
        : {}),
      fixedTime: import.meta.env.DEV && parseTimeOverride(window.location.search) !== null,
      // Datos en vivo (worker + deck.gl) tras el primer fotograma, para no competir con la carga.
      onFirstFrame: () => {
        const target = pulsoMap?.map;
        if (!target) return;
        void import("./share/start")
          .then((m) =>
            m.startShare({
              map: target,
              host: shell,
              t,
              initial: shared ?? { mode: "view" },
              getMode,
              getReplay: () => replayController,
              restoreReplay,
              showButton: features.share,
            }),
          )
          .catch((error: unknown) => console.error("[share] no se pudo iniciar", error));
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
