import { describe, expect, it } from "vitest";
import { FpsMonitor, type QualityLevel } from "./monitor";

/** Alimenta el monitor con fotogramas a `fps` durante `ms`; devuelve los cambios con su instante. */
class Driver {
  t = 0;
  changes: Array<{ t: number; level: QualityLevel }> = [];
  constructor(readonly m: FpsMonitor) {}
  run(fps: number, ms: number): void {
    const dt = 1000 / fps;
    const end = this.t + ms;
    while (this.t < end) {
      this.t += dt;
      const c = this.m.frame(this.t);
      if (c) this.changes.push({ t: this.t, level: c });
    }
  }
}

/** Arranque ya superado: 6 s a 60 fps (calentamiento de 5 s). */
function warm(opts = {}): Driver {
  const d = new Driver(new FpsMonitor(opts));
  d.run(60, 6000);
  expect(d.changes).toEqual([]);
  return d;
}

describe("FpsMonitor", () => {
  it("degrada a los 3 s sostenidos por debajo de 45 fps, no antes", () => {
    const d = warm();
    const start = d.t;
    d.run(30, 2900);
    expect(d.m.level).toBe("high");
    d.run(30, 1300);
    expect(d.m.level).toBe("medium");
    // La ventana de 1 s tarda un instante en notar la caída: ~3 s, nunca menos.
    const at = (d.changes[0]?.t ?? 0) - start;
    expect(at).toBeGreaterThanOrEqual(3000);
    expect(at).toBeLessThan(4300);
  });

  it("no degrada con picos cortos", () => {
    const d = warm();
    for (let i = 0; i < 6; i++) {
      d.run(20, 1500); // 1,5 s lento
      d.run(60, 1500);
    }
    expect(d.changes).toEqual([]);
    expect(d.m.level).toBe("high");
  });

  it("dos niveles seguidos hasta el mínimo y ahí se queda", () => {
    const d = warm();
    d.run(25, 20_000);
    expect(d.changes.map((c) => c.level)).toEqual(["medium", "low"]);
    expect(d.m.level).toBe("low");
    expect((d.changes[1]?.t ?? 0) - (d.changes[0]?.t ?? 0)).toBeGreaterThanOrEqual(3000);
  });

  it("recupera con histéresis: 55+ fps 10 s, no antes; entre 45 y 55 no cambia nada", () => {
    const d = warm();
    d.run(25, 4000);
    expect(d.m.level).toBe("medium");
    d.run(50, 60_000); // zona muerta
    expect(d.m.level).toBe("medium");
    d.run(60, 9000);
    expect(d.m.level).toBe("medium");
    d.run(60, 2000);
    expect(d.m.level).toBe("high");
  });

  it("no oscila: si recuperar vuelve a degradar, la próxima recuperación espera más", () => {
    const d = warm();
    d.run(25, 4000); // medium
    d.run(60, 11_000); // high
    expect(d.m.level).toBe("high");
    d.run(25, 4000); // vuelve a medium
    expect(d.m.level).toBe("medium");
    const before = d.changes.length;
    d.run(60, 11_000); // 10 s ya no bastan (espera ×2)
    expect(d.changes.length).toBe(before);
    d.run(60, 11_000);
    expect(d.m.level).toBe("high");
  });

  it("ignora el arranque: nada cambia durante el calentamiento", () => {
    const d = new Driver(new FpsMonitor());
    d.run(10, 4900);
    expect(d.changes).toEqual([]);
    d.run(10, 3500);
    expect(d.m.level).toBe("medium");
  });

  it("ignora la pestaña oculta y los huecos largos", () => {
    const d = warm();
    d.run(25, 2000);
    d.m.setActive(false);
    d.t += 60_000; // oculta: rAF parado
    expect(d.m.frame(d.t)).toBeNull();
    d.m.setActive(true);
    d.run(25, 2000); // la cuenta empezó de cero: aún no son 3 s
    expect(d.m.level).toBe("high");
    d.run(25, 2000);
    expect(d.m.level).toBe("medium");

    const e = warm();
    e.t += 30_000; // hueco sin avisar (segundo plano)
    e.run(60, 3000);
    expect(e.changes).toEqual([]);
  });

  it("force fija el nivel sin histéresis", () => {
    const m = new FpsMonitor();
    m.force("low");
    expect(m.level).toBe("low");
  });
});
