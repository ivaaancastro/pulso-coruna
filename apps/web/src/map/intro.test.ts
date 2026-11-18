import { describe, expect, it } from "vitest";
import {
  INTRO_DURATION_MS,
  INTRO_HOLD_MS,
  cameraAt,
  cameraAtTime,
  createIntro,
  createOrbit,
  decideIntro,
  decideOrbit,
  easeInOutCubic,
  easeOutCubic,
  easeOutExpo,
  introStart,
  type Camera,
  type InterruptSource,
  type Scheduler,
} from "./intro";

const END: Camera = { center: [-8.4065, 43.3755], zoom: 14.2, pitch: 58, bearing: 20 };
const START = introStart(END);

/** Planificador manual: `step(ms)` avanza el reloj y ejecuta el siguiente fotograma. */
function fakeScheduler() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, (t: number) => void>();
  const scheduler: Scheduler = {
    now: () => now,
    request: (cb) => {
      const id = next++;
      pending.set(id, cb);
      return id;
    },
    cancel: (id) => void pending.delete(id),
  };
  return {
    scheduler,
    step(ms: number) {
      now += ms;
      const cbs = [...pending.values()];
      pending.clear();
      for (const cb of cbs) cb(now);
    },
    get pending() {
      return pending.size;
    },
  };
}

function fakeInterrupts() {
  const handlers = new Set<() => void>();
  const source: InterruptSource = {
    listen(fn) {
      handlers.add(fn);
      return () => void handlers.delete(fn);
    },
  };
  return { source, fire: () => [...handlers].forEach((h) => h()), count: () => handlers.size };
}

function setup() {
  const sched = fakeScheduler();
  const input = fakeInterrupts();
  const calls: Partial<Camera>[] = [];
  const marks: string[] = [];
  const intro = createIntro({
    target: { jumpTo: (c) => void calls.push(c) },
    from: START,
    to: END,
    scheduler: sched.scheduler,
    interrupts: input.source,
    mark: (n) => void marks.push(n),
  });
  return { sched, input, calls, marks, intro };
}

describe("easing", () => {
  it("fijan 0 y 1 en los extremos y no rebasan", () => {
    for (const f of [easeOutCubic, easeInOutCubic, easeOutExpo]) {
      expect(f(0)).toBeCloseTo(0, 2);
      expect(f(1)).toBe(1);
      for (let t = 0; t <= 1; t += 0.05) {
        expect(f(t)).toBeGreaterThanOrEqual(-0.001);
        expect(f(t)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("las curvas «out» salen más rápido que lineal y son monótonas", () => {
    expect(easeOutCubic(0.3)).toBeGreaterThan(0.3);
    expect(easeOutExpo(0.3)).toBeGreaterThan(easeOutCubic(0.3));
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.01) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("keyframes", () => {
  it("empieza amplio y bajo sobre el mar y acaba exactamente en la cámara final", () => {
    expect(START.zoom).toBeLessThan(END.zoom - 1);
    expect(START.pitch).toBeLessThan(END.pitch);
    expect(START.center[1]).toBeGreaterThan(END.center[1]); // al norte: mar abierto
    expect(cameraAt(0, START, END)).toEqual(START);
    expect(cameraAt(1, START, END)).toEqual(END);
  });

  it("el giro de bearing es suave y hacia la cámara final (sin cruzar 180°)", () => {
    expect(Math.abs(END.bearing - START.bearing)).toBeLessThan(90);
    let prev = START.bearing;
    for (let t = 0; t <= 1; t += 0.02) {
      const b = cameraAt(t, START, END).bearing;
      expect(b).toBeGreaterThanOrEqual(prev);
      expect(b).toBeLessThanOrEqual(END.bearing);
      prev = b;
    }
  });

  it("el progreso fuera de rango se acota", () => {
    expect(cameraAt(-3, START, END)).toEqual(START);
    expect(cameraAt(9, START, END)).toEqual(END);
  });

  it("dura menos de 4 s y mantiene el plano inicial durante la espera", () => {
    expect(INTRO_DURATION_MS).toBeLessThan(4000);
    expect(cameraAtTime(0, START, END)).toEqual(START);
    expect(cameraAtTime(INTRO_HOLD_MS, START, END)).toEqual(START);
    expect(cameraAtTime(INTRO_DURATION_MS - 1, START, END)?.zoom).toBeCloseTo(END.zoom, 1);
    expect(cameraAtTime(INTRO_DURATION_MS, START, END)).toBeNull();
  });
});

describe("decisión", () => {
  const base = { search: "", dev: false, reducedMotion: false };
  it("reproduce por defecto", () => expect(decideIntro(base)).toEqual({ play: true }));
  it("reduced-motion: sin vuelo, aunque se pida", () => {
    expect(decideIntro({ ...base, reducedMotion: true })).toEqual({
      play: false,
      reason: "reduced-motion",
    });
    expect(decideIntro({ ...base, dev: true, search: "?intro=1", reducedMotion: true }).play).toBe(
      false,
    );
  });
  it("?intro=0 solo salta en dev", () => {
    expect(decideIntro({ ...base, dev: true, search: "?intro=0" })).toEqual({
      play: false,
      reason: "disabled",
    });
    expect(decideIntro({ ...base, dev: false, search: "?intro=0" })).toEqual({ play: true });
  });
  it("órbita: solo dev, ?orbit=1 y sin reduced-motion", () => {
    expect(decideOrbit({ ...base, dev: true, search: "?orbit=1" })).toBe(true);
    expect(decideOrbit({ ...base, dev: false, search: "?orbit=1" })).toBe(false);
    expect(decideOrbit({ ...base, dev: true, search: "?orbit=1", reducedMotion: true })).toBe(
      false,
    );
    expect(decideOrbit({ ...base, dev: true })).toBe(false);
  });
});

describe("controlador", () => {
  it("reproduce hasta el final, marca start/end y termina en la cámara final", () => {
    const { sched, calls, marks, intro } = setup();
    intro.start();
    expect(marks).toEqual(["map:intro-start"]);
    for (let i = 0; i < 400 && intro.state === "running"; i++) sched.step(16);
    expect(intro.state).toBe("done");
    expect(marks).toEqual(["map:intro-start", "map:intro-end"]);
    expect(calls.at(-1)).toEqual(END);
    expect(sched.pending).toBe(0);
  });

  it("interrumpir cancela: no hay más movimientos de cámara ni se reanuda", () => {
    const { sched, input, calls, marks, intro } = setup();
    intro.start();
    sched.step(16);
    sched.step(800);
    const before = calls.length;
    input.fire();
    expect(intro.state).toBe("done");
    expect(marks).toEqual(["map:intro-start", "map:intro-interrupted"]);
    for (let i = 0; i < 50; i++) sched.step(100);
    expect(calls.length).toBe(before); // la cámara se queda donde el usuario la lleve
    expect(input.count()).toBe(0);
    intro.start(); // una sola ejecución: no reanuda
    expect(intro.state).toBe("done");
    expect(sched.pending).toBe(0);
    expect(marks).toHaveLength(2);
  });

  it("llamar a cancel tras terminar o dos veces no repite marcas", () => {
    const { sched, marks, intro } = setup();
    intro.start();
    intro.cancel();
    intro.cancel();
    sched.step(16);
    expect(marks).toEqual(["map:intro-start", "map:intro-interrupted"]);
  });

  it("start repetido no duplica ni reinicia", () => {
    const { sched, marks, intro } = setup();
    intro.start();
    intro.start();
    expect(marks).toEqual(["map:intro-start"]);
    expect(sched.pending).toBe(1);
  });
});

describe("órbita", () => {
  it("solo gira el bearing y para con la interacción", () => {
    const sched = fakeScheduler();
    const input = fakeInterrupts();
    const calls: Partial<Camera>[] = [];
    createOrbit({
      target: { jumpTo: (c) => void calls.push(c) },
      from: END,
      scheduler: sched.scheduler,
      interrupts: input.source,
    });
    sched.step(1000);
    expect(Object.keys(calls[0] ?? {})).toEqual(["bearing"]);
    expect(calls[0]?.bearing).toBeGreaterThan(END.bearing);
    expect(calls[0]?.bearing).toBeLessThan(END.bearing + 3); // muy lenta
    input.fire();
    const n = calls.length;
    sched.step(1000);
    expect(calls.length).toBe(n);
    expect(sched.pending).toBe(0);
  });
});
