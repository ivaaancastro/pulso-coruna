import type { Locale, Translate } from "../i18n";
import {
  createLiveClient,
  type LiveClient,
  type MotionQueryLike,
  type WorkerLike,
} from "../live/client";
import type { SwitchableStore } from "../live/switchable-store";
import type { WorkerOutput } from "../live/types";
import { madridDayEnd, madridDayStart, recentDays } from "../time/day";
import { setClockOverride as defaultSetOverride } from "../time/now";
import { ReplayClock } from "./clock";
import { createTimelineView, type StatusKind, type TimelineView } from "./timeline-view";
import type { ReplaySpeed, ReplayStatus } from "./types";

/** Días entre los que se puede elegir (la API no dice cuáles tienen datos: ver spec M6.3). */
export const DAYS_AVAILABLE = 30;
/** Al entrar, el cursor arranca una hora antes de «ahora» (pausado). */
export const START_OFFSET_MS = 3_600_000;
/** La carga solo se anuncia si dura más que esto, ms (evita parpadeos). */
export const LOADING_DELAY_MS = 350;

/**
 * Estado de la reproducción, serializable (M6.4 lo conectará a la URL). Todo en UTC epoch ms;
 * `day` es el inicio del día de Madrid que se está viendo.
 */
export interface ReplayState {
  mode: "view" | "replay";
  /** Instante (epoch ms UTC). */
  t: number;
  speed: ReplaySpeed;
  /** Inicio (epoch ms UTC) del día de Madrid seleccionado. */
  day: number;
  playing: boolean;
}

export interface ReplayControllerOptions {
  live: { client: LiveClient; view: SwitchableStore };
  /** `…/api/v1/replay` (nuestra API). */
  replayUrl: string;
  /** Reloj «base» de la app (hora real o `?t=` en desarrollo), sin el override de Reproducir. */
  baseNow: () => number;
  /** El reloj grande de la hora (`components/clock.ts`). */
  showTime: (ms: number) => void;
  /** Reaplica la luz del mapa para la hora de la app. */
  refreshPalette: () => void;
  /** Dónde montar la barra y ante qué elemento (el selector de modo). */
  host: HTMLElement;
  before?: Node | null;
  t: Translate;
  locale: Locale;
  motion: MotionQueryLike;
  createWorker: () => WorkerLike;
  /** Doble de `time/now.setClockOverride` en tests. */
  setClockOverride?: (clock: (() => number) | null) => void;
  perf?: () => number;
  /** Planificador de fotogramas (rAF); devuelve cómo cancelar. */
  raf?: (cb: () => void) => () => void;
  /** Dónde se escribe `--pulso-timeline-h` (por defecto `:root`). */
  cssRoot?: HTMLElement;
}

export interface ReplayController {
  readonly active: boolean;
  enter(): void;
  exit(): void;
  getState(): ReplayState;
  /** Aplica un estado (M6.4: restaurar desde la URL). Entra en Reproducir si `mode` es `replay`. */
  applyState(state: Partial<ReplayState>): void;
  /** Estado de carga que publica el worker (para depurar y para tests). */
  readonly status: ReplayStatus;
  destroy(): void;
}

const defaultRaf = (cb: () => void): (() => void) => {
  const id = requestAnimationFrame(cb);
  return () => cancelAnimationFrame(id);
};

const IDLE_STATUS: ReplayStatus = { loading: false, error: null, noData: false, resolution: null };

/**
 * Orquesta el modo Reproducir sin duplicar nada del modo En vivo: el mismo overlay, las mismas
 * capas y el mismo monitor de fuentes, que solo cambian de dónde leen (`SwitchableStore`) y qué
 * hora usan (`setClockOverride`). Mientras dura:
 * - el directo sigue recibiendo en su worker pero no se dibuja (`client.setActive(false)`);
 * - un worker propio descarga y calcula el histórico (`replay.worker.ts`) y alimenta un `LiveStore`;
 * - el reloj de la app es el de reproducción: el día/noche, «hace X» y las comprobaciones de
 *   frescura (M4.6) se evalúan contra el instante reproducido, no contra «ahora».
 */
export function createReplayController(opts: ReplayControllerOptions): ReplayController {
  const perf = opts.perf ?? (() => performance.now());
  const raf = opts.raf ?? defaultRaf;
  const override = opts.setClockOverride ?? defaultSetOverride;
  const cssRoot = opts.cssRoot ?? document.documentElement;

  const clock = new ReplayClock({ perf });
  const days = recentDays(opts.baseNow(), DAYS_AVAILABLE);
  const today = days[0] as number;

  let day = today;
  let initialized = false;
  let active = false;
  let client: LiveClient | null = null;
  let status: ReplayStatus = IDLE_STATUS;
  let loadingSince: number | null = null;
  let ended = false;
  let cancelFrame: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastMinute = Number.NaN;
  let lastPaletteAt = Number.NEGATIVE_INFINITY;
  let lastPaletteKey = Number.NaN;
  let scrubResume = false;
  let resizeObserver: ResizeObserver | null = null;
  let limitSet = Number.NaN;

  const dayEnd = (): number => madridDayEnd(day);
  const limitNow = (): number => Math.min(dayEnd(), opts.baseNow());

  const view: TimelineView = createTimelineView({
    t: opts.t,
    locale: opts.locale,
    days,
    today,
    handlers: {
      onSeek: (target) => {
        ended = false;
        clock.seek(target);
        render();
        applyTime(true);
      },
      onScrubStart: () => {
        scrubResume = clock.playing;
        clock.pause();
      },
      onScrubEnd: () => {
        if (scrubResume) clock.play();
        scrubResume = false;
        applyTime(true);
      },
      onToggle: () => {
        ended = false;
        clock.toggle();
        render();
      },
      onSpeed: (speed) => {
        clock.setSpeed(speed);
        render();
      },
      onDay: (next) => setDay(next),
    },
  });

  const reducedMotion = (): boolean => opts.motion.matches;

  const statusUi = (now: number): { kind: StatusKind; text: string } => {
    if (status.error) {
      const key = status.error === "network" ? "replay.error.network" : "replay.error.server";
      return { kind: "error", text: opts.t(key) };
    }
    if (status.loading && loadingSince !== null && now - loadingSince >= LOADING_DELAY_MS) {
      return { kind: "loading", text: opts.t("replay.loading") };
    }
    if (status.noData) return { kind: "nodata", text: opts.t("replay.nodata") };
    if (ended) return { kind: "ended", text: opts.t("replay.ended") };
    if (status.resolution === "1m") return { kind: "coarse", text: opts.t("replay.coarse") };
    return { kind: "none", text: "" };
  };

  /** Pinta la barra con el instante actual. */
  function render(): void {
    const t = clock.read();
    view.update({
      t,
      dayStart: day,
      dayEnd: dayEnd(),
      limit: clock.max,
      playing: clock.playing,
      speed: clock.speed,
      status: statusUi(perf()),
    });
  }

  /** Hora grande y luz del mapa: al cambiar de minuto (o a la fuerza tras un salto), sin saturar. */
  function applyTime(force: boolean): void {
    const t = clock.read();
    const minute = Math.floor(t / 60_000);
    if (force || minute !== lastMinute) {
      lastMinute = minute;
      opts.showTime(t);
    }
    // La luz solo cambia de forma apreciable cada pocos minutos de reproducción.
    const key = Math.floor(t / 180_000);
    const at = perf();
    if ((force || key !== lastPaletteKey) && at - lastPaletteAt >= (force ? 120 : 800)) {
      lastPaletteKey = key;
      lastPaletteAt = at;
      opts.refreshPalette();
    }
  }

  function frame(): void {
    cancelFrame = null;
    timer = null;
    if (!active) return;
    const limit = limitNow();
    // «Ahora» avanza: se actualiza el límite sin avisar en cada fotograma.
    if (!(Math.abs(limit - limitSet) < 1000)) {
      limitSet = limit;
      clock.setBounds(day, limit);
    }
    applyTime(false);
    render();
    schedule();
  }

  function schedule(): void {
    if (!active) return;
    if (reducedMotion()) timer = setTimeout(frame, 250);
    else cancelFrame = raf(frame);
  }

  function onOutput(out: WorkerOutput): void {
    if (out.type !== "replay") return;
    const wasLoading = status.loading;
    status = out.status;
    if (status.loading && !wasLoading) loadingSince = perf();
    if (!status.loading) loadingSince = null;
    // Sin la ventana del instante el reloj espera (no se pierde ni se inventa tiempo).
    clock.setStalled(status.loading);
  }

  clock.subscribe((event) => {
    if (event === "end") ended = true;
  });

  function setDay(next: number): void {
    const before = clock.read();
    const offset = before - day;
    day = next;
    ended = false;
    limitSet = limitNow();
    clock.setBounds(day, limitSet);
    // Mantiene la hora del día (acotada si el día nuevo es más corto o es hoy).
    clock.seek(day + Math.min(offset, madridDayEnd(day) - day));
    render();
    applyTime(true);
  }

  function enter(): void {
    if (active) return;
    const base = opts.baseNow();
    if (!initialized) {
      initialized = true;
      day = madridDayStart(base);
      limitSet = Math.min(dayEnd(), base);
      clock.setBounds(day, limitSet);
      clock.seek(Math.max(day, base - START_OFFSET_MS));
      clock.pause();
    } else {
      limitSet = limitNow();
      clock.setBounds(day, limitSet);
    }
    status = IDLE_STATUS;
    loadingSince = null;
    ended = false;
    clock.setStalled(false);

    const worker = opts.createWorker(); // si falla, no queda a medio entrar
    client = createLiveClient({
      worker,
      url: opts.replayUrl,
      now: () => clock.read(),
      motion: opts.motion,
      reducedTickMs: 250,
      onOutput,
    });
    active = true;
    // El reloj de la app pasa a ser el de reproducción antes de que las capas vuelvan a leer.
    override(() => clock.read());
    client.start();
    opts.live.client.setActive(false);
    opts.live.view.use(client.store);

    opts.host.insertBefore(view.element, opts.before ?? null);
    view.element.hidden = false;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(reserveSpace);
      resizeObserver.observe(view.element);
    }
    reserveSpace();
    lastMinute = Number.NaN;
    lastPaletteKey = Number.NaN;
    lastPaletteAt = Number.NEGATIVE_INFINITY;
    applyTime(true);
    render();
    schedule();
  }

  /** Reserva en `--pulso-timeline-h` lo que ocupa la barra, para que la tarjeta quede encima. */
  function reserveSpace(): void {
    const style = getComputedStyle(view.element);
    const h = view.element.offsetHeight + (Number.parseFloat(style.marginBottom) || 0);
    cssRoot.style.setProperty("--pulso-timeline-h", `${h}px`);
  }

  function exit(): void {
    if (!active) return;
    active = false;
    clock.pause();
    scrubResume = false;
    if (cancelFrame) cancelFrame();
    if (timer) clearTimeout(timer);
    cancelFrame = timer = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    // Primero se vuelve a la hora y a los datos en vivo; luego se desmonta lo del histórico.
    override(null);
    opts.live.view.use(opts.live.client.store);
    opts.live.client.setActive(true);
    client?.stop(); // termina el worker de reproducción y con él sus descargas
    client = null;
    view.element.hidden = true;
    cssRoot.style.setProperty("--pulso-timeline-h", "0px");
    opts.showTime(opts.baseNow());
    opts.refreshPalette();
  }

  return {
    get active() {
      return active;
    },
    get status() {
      return status;
    },
    enter,
    exit,
    getState() {
      return {
        mode: active ? "replay" : "view",
        t: clock.read(),
        speed: clock.speed,
        day,
        playing: clock.playing,
      };
    },
    applyState(state) {
      if (state.mode === "view") exit();
      // El instante pedido se coloca ANTES de entrar: así el worker descarga directamente la ventana
      // del enlace y no la de hace una hora (una petición de más a la API, con el límite global de 2).
      if (state.t !== undefined && state.mode === "replay") initialized = true;
      else if (state.mode === "replay") enter(); // sin instante: arranca como siempre (hace 1 h) y aplica el resto
      if (state.day !== undefined && madridDayStart(state.day) !== day) {
        day = madridDayStart(state.day);
        limitSet = limitNow();
        clock.setBounds(day, limitSet);
      }
      if (state.speed !== undefined) clock.setSpeed(state.speed);
      if (state.t !== undefined) {
        const target = state.t;
        if (target < day || target >= dayEnd()) {
          day = madridDayStart(target);
          limitSet = limitNow();
          clock.setBounds(day, limitSet);
        }
        clock.seek(target);
      }
      if (state.mode === "replay") enter();
      if (state.playing !== undefined) {
        if (state.playing) clock.play();
        else clock.pause();
      }
      if (active) {
        render();
        applyTime(true);
      }
    },
    destroy() {
      exit();
      view.destroy();
    },
  };
}
