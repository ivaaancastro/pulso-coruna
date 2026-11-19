import { describe, expect, it } from "vitest";
import { ReplayClock, type ClockEvent } from "./clock";

const T0 = 1_760_000_000_000;

function setup(speed: 1 | 60 | 600 = 60) {
  let perf = 0;
  const clock = new ReplayClock({ perf: () => perf, speed });
  clock.setBounds(T0, T0 + 24 * 3_600_000);
  clock.seek(T0 + 3_600_000);
  const events: ClockEvent[] = [];
  clock.subscribe((e) => events.push(e));
  return { clock, events, advance: (ms: number) => (perf += ms) };
}

describe("ReplayClock", () => {
  it("en pausa no avanza", () => {
    const { clock, advance } = setup();
    const t = clock.read();
    advance(200);
    expect(clock.read()).toBe(t);
  });

  it("avanza speed veces el tiempo real: 1×, 60× y 600×", () => {
    for (const speed of [1, 60, 600] as const) {
      const { clock, advance } = setup(speed);
      const t = clock.read();
      clock.play();
      advance(100);
      expect(clock.read() - t).toBe(100 * speed);
    }
  });

  it("600×: un fotograma de 16,7 ms son 10 s de reproducción (un día en 144 s)", () => {
    const { clock, advance } = setup(600);
    clock.seek(T0);
    clock.play();
    let frames = 0;
    while (clock.playing && frames < 20_000) {
      advance(1000 / 60);
      clock.read();
      frames++;
    }
    expect(clock.read()).toBe(T0 + 24 * 3_600_000);
    expect(frames / 60).toBeCloseTo(144, 0);
  });

  it("cambiar de velocidad no da saltos: integra con la velocidad anterior hasta ese instante", () => {
    const { clock, advance } = setup(60);
    const t = clock.read();
    clock.play();
    advance(100);
    clock.setSpeed(600);
    advance(100);
    expect(clock.read() - t).toBe(100 * 60 + 100 * 600);
  });

  it("detenido por falta de datos (stall) no avanza y retoma al liberarse", () => {
    const { clock, advance } = setup(60);
    clock.play();
    advance(100);
    const t = clock.read();
    clock.setStalled(true);
    advance(200);
    expect(clock.read()).toBe(t);
    clock.setStalled(false);
    advance(50);
    expect(clock.read()).toBe(t + 50 * 60);
    expect(clock.playing).toBe(true);
  });

  it("con la pestaña oculta (un solo salto enorme) no salta horas: se limita el paso", () => {
    const { clock, advance } = setup(600);
    const t = clock.read();
    clock.play();
    advance(60_000);
    expect(clock.read() - t).toBe(250 * 600);
  });

  it("seek se acota a los límites del día; en el límite superior se pausa y avisa", () => {
    const { clock, advance, events } = setup(600);
    clock.seek(T0 - 5_000);
    expect(clock.read()).toBe(T0);
    clock.seek(T0 + 99 * 3_600_000);
    expect(clock.read()).toBe(T0 + 24 * 3_600_000);
    clock.seek(T0 + 24 * 3_600_000 - 1000);
    clock.play();
    advance(100);
    clock.read();
    expect(clock.playing).toBe(false);
    expect(clock.read()).toBe(T0 + 24 * 3_600_000);
    expect(events).toContain("end");
  });

  it("al reproducir desde el final, vuelve al principio del día", () => {
    const { clock } = setup();
    clock.seek(T0 + 24 * 3_600_000);
    clock.play();
    expect(clock.read()).toBe(T0);
    expect(clock.playing).toBe(true);
  });

  it("al reducir los límites (cambio de día) encaja el instante dentro", () => {
    const { clock } = setup();
    clock.seek(T0 + 20 * 3_600_000);
    clock.setBounds(T0, T0 + 3_600_000);
    expect(clock.read()).toBe(T0 + 3_600_000);
  });

  it("emite eventos de play, pause, speed, seek y stall", () => {
    const { clock, events } = setup();
    clock.play();
    clock.setSpeed(600);
    clock.seek(T0 + 5);
    clock.setStalled(true);
    clock.pause();
    expect(events).toEqual(["play", "speed", "seek", "stall", "pause"]);
    clock.setSpeed(600); // sin cambio: sin evento
    expect(events).toHaveLength(5);
  });
});
