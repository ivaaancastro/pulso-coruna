/**
 * Intro de cámara (M2.3). Lógica pura y sin dependencias de MapLibre: se testea con un mapa y un
 * planificador falsos. La cámara se calcula por progreso (0..1) y se aplica con `jumpTo` en cada
 * fotograma; así una interrupción simplemente deja de llamar y la cámara se queda donde está.
 */

export interface Camera {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

/** Duración total de la coreografía. Criterio M2.3: < 4 s (la dirección de arte reserva 3,8 s). */
export const INTRO_DURATION_MS = 3600;
/** Plano quieto inicial para que se lea el mar antes de moverse. */
export const INTRO_HOLD_MS = 250;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Plano de salida: mar abierto al noreste de la península, cámara alta y de lado (bearing
 * negativo), mirando hacia la Torre de Hércules. `end` es la cámara inicial del mapa.
 */
export function introStart(end: Camera): Camera {
  return {
    center: [end.center[0] + 0.03, end.center[1] + 0.012],
    zoom: end.zoom - 2,
    pitch: 28,
    bearing: end.bearing - 55,
  };
}

/**
 * Cámara en el progreso `p` (0..1, tras la espera inicial). Cada canal tiene su curva: centro y
 * zoom salen rápidos y se asientan largo (expo/cubic out, cámara de dron), el pitch sube con una
 * S suave y el giro termina despacio. Sin rebotes: ningún canal rebasa su valor final.
 */
export function cameraAt(progress: number, from: Camera, to: Camera): Camera {
  const p = clamp01(progress);
  const move = easeOutExpo(p);
  const zoom = easeOutCubic(p);
  const tilt = easeInOutCubic(p);
  const turn = easeOutCubic(p);
  return {
    center: [lerp(from.center[0], to.center[0], move), lerp(from.center[1], to.center[1], move)],
    zoom: lerp(from.zoom, to.zoom, zoom),
    pitch: lerp(from.pitch, to.pitch, tilt),
    bearing: lerp(from.bearing, to.bearing, turn),
  };
}

/** Cámara a `elapsed` ms desde el inicio de la intro, o `null` cuando ya terminó. */
export function cameraAtTime(elapsedMs: number, from: Camera, to: Camera): Camera | null {
  if (elapsedMs >= INTRO_DURATION_MS) return null;
  const t = (elapsedMs - INTRO_HOLD_MS) / (INTRO_DURATION_MS - INTRO_HOLD_MS);
  return cameraAt(t, from, to);
}

export type IntroSkipReason = "reduced-motion" | "disabled";

export interface IntroDecisionInput {
  /** `window.location.search`. */
  search: string;
  /** `import.meta.env.DEV`: `?intro=0` y `?orbit=1` solo se respetan en desarrollo. */
  dev: boolean;
  reducedMotion: boolean;
}

/** Decide si se reproduce la intro. Reduced-motion manda sobre todo lo demás. */
export function decideIntro(
  input: IntroDecisionInput,
): { play: true } | { play: false; reason: IntroSkipReason } {
  if (input.reducedMotion) return { play: false, reason: "reduced-motion" };
  if (input.dev && new URLSearchParams(input.search).get("intro") === "0") {
    return { play: false, reason: "disabled" };
  }
  return { play: true };
}

/** Órbita lenta opcional tras la intro (demo): `?orbit=1`, solo dev y sin reduced-motion. */
export const ORBIT_DEG_PER_SEC = 1.2;
export function decideOrbit(input: IntroDecisionInput): boolean {
  return (
    input.dev && !input.reducedMotion && new URLSearchParams(input.search).get("orbit") === "1"
  );
}

export interface CameraTarget {
  jumpTo(camera: Partial<Camera>): unknown;
}

export interface Scheduler {
  now(): number;
  request(cb: (now: number) => void): number;
  cancel(id: number): void;
}

export interface InterruptSource {
  /** Registra el aviso de «el usuario ha tocado algo» y devuelve cómo quitarlo. */
  listen(onInput: () => void): () => void;
}

export type IntroEnd = "end" | "interrupted";

export interface IntroOptions {
  target: CameraTarget;
  from: Camera;
  to: Camera;
  scheduler: Scheduler;
  interrupts: InterruptSource;
  /** Marcas de rendimiento: `map:intro-start`, `map:intro-end`, `map:intro-interrupted`. */
  mark: (name: string) => void;
  /** Al terminar (llegada o interrupción). Aquí se engancha la órbita opcional. */
  onDone?: (how: IntroEnd) => void;
}

export interface IntroController {
  start(): void;
  /** Interrumpe sin mover la cámara. No hace nada si ya terminó. */
  cancel(): void;
  readonly state: "idle" | "running" | "done";
}

/** Una sola ejecución: `start()` repetido o tras terminar no hace nada. */
export function createIntro(opts: IntroOptions): IntroController {
  let state: IntroController["state"] = "idle";
  let frame = 0;
  let t0 = 0;
  let unlisten: (() => void) | undefined;

  const finish = (how: IntroEnd): void => {
    state = "done";
    opts.scheduler.cancel(frame);
    unlisten?.();
    unlisten = undefined;
    opts.mark(how === "end" ? "map:intro-end" : "map:intro-interrupted");
    opts.onDone?.(how);
  };

  const tick = (now: number): void => {
    if (state !== "running") return;
    const cam = cameraAtTime(now - t0, opts.from, opts.to);
    if (cam === null) {
      opts.target.jumpTo(opts.to);
      finish("end");
      return;
    }
    opts.target.jumpTo(cam);
    frame = opts.scheduler.request(tick);
  };

  const controller: IntroController = {
    start() {
      if (state !== "idle") return;
      state = "running";
      t0 = opts.scheduler.now();
      opts.mark("map:intro-start");
      unlisten = opts.interrupts.listen(() => controller.cancel());
      frame = opts.scheduler.request(tick);
    },
    cancel() {
      if (state === "running") finish("interrupted");
    },
    get state() {
      return state;
    },
  };
  return controller;
}

/** Órbita lenta: solo el bearing, a velocidad constante, hasta la primera interacción. */
export function createOrbit(opts: {
  target: CameraTarget;
  from: Camera;
  scheduler: Scheduler;
  interrupts: InterruptSource;
}): { stop(): void } {
  const t0 = opts.scheduler.now();
  let frame = 0;
  let running = true;
  let unlisten: () => void = () => undefined;
  const stop = (): void => {
    if (!running) return;
    running = false;
    opts.scheduler.cancel(frame);
    unlisten();
  };
  unlisten = opts.interrupts.listen(stop);
  const tick = (now: number): void => {
    if (!running) return;
    opts.target.jumpTo({ bearing: opts.from.bearing + ((now - t0) / 1000) * ORBIT_DEG_PER_SEC });
    frame = opts.scheduler.request(tick);
  };
  frame = opts.scheduler.request(tick);
  return { stop };
}

/** Eventos DOM que cuentan como interacción: toque, arrastre, rueda, teclado y clic en controles. */
const INTERRUPT_EVENTS = ["pointerdown", "wheel", "keydown", "touchstart", "mousedown"] as const;

export function domInterrupts(target: Window = window): InterruptSource {
  return {
    listen(onInput) {
      const handler = (): void => onInput();
      // Captura y pasivo: no retrasa el gesto ni depende de que otro handler lo detenga.
      for (const name of INTERRUPT_EVENTS) {
        target.addEventListener(name, handler, { capture: true, passive: true });
      }
      return () => {
        for (const name of INTERRUPT_EVENTS) {
          target.removeEventListener(name, handler, { capture: true });
        }
      };
    },
  };
}

export const rafScheduler: Scheduler = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};
