import { LAYER_IDS } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import {
  buildShareUrl,
  CAMERA_LIMITS,
  MAX_HASH_LENGTH,
  parseShareHash,
  SHARE_LAYER_IDS,
  serializeShareState,
  type ShareState,
} from "./url-state";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const DAY = 86_400_000;
const parse = (hash: string): ShareState => parseShareHash(hash, NOW);

describe("URL compartible: ida y vuelta", () => {
  it("reproduce cámara, capas, modo, instante y velocidad", () => {
    const state: ShareState = {
      camera: { lat: 43.3623, lon: -8.4115, zoom: 13.5, bearing: -32.5, pitch: 45 },
      layers: ["bus", "bike"],
      mode: "replay",
      t: Date.parse("2026-11-18T10:30:00Z"),
      speed: 60,
    };
    const hash = serializeShareState(state);
    expect(hash).toBe(
      "#v=1&c=43.3623,-8.4115,13.5,-32.5,45&l=bus,bike&m=r&t=2026-11-18T10:30Z&s=60",
    );
    expect(parse(hash)).toEqual(state);
  });

  it("modo Ver: no escribe t ni velocidad aunque vengan en el estado", () => {
    const hash = serializeShareState({
      mode: "view",
      camera: { lat: 43.37, lon: -8.4, zoom: 14, bearing: 0, pitch: 0 },
      t: NOW - 1000,
      speed: 600,
    });
    expect(hash).toBe("#v=1&c=43.37,-8.4,14,0,0");
    expect(hash).not.toContain("t=");
    expect(hash).not.toContain("s=");
  });

  it("sin nada que compartir, el hash queda vacío", () => {
    expect(serializeShareState({ mode: "view" })).toBe("");
  });

  it("el instante se redondea al minuto y la vuelta es estable", () => {
    const hash = serializeShareState({ mode: "replay", t: Date.parse("2026-11-18T10:30:45.678Z") });
    expect(hash).toBe("#v=1&m=r&t=2026-11-18T10:30Z");
    expect(serializeShareState(parse(hash))).toBe(hash);
  });

  it("nunca escribe p=1 por su cuenta; sí lo entiende al leer", () => {
    expect(serializeShareState({ mode: "replay", t: NOW - DAY })).not.toContain("p=");
    expect(parse("#v=1&m=r&p=1").play).toBe(true);
    expect(parse("#v=1&m=r").play).toBeUndefined();
  });

  it("acepta comas codificadas (%2C) y segundos en el instante", () => {
    const s = parse("#v=1&c=43.37%2C-8.4%2C14%2C0%2C30&m=r&t=2026-11-18T10:30:15Z");
    expect(s.camera?.zoom).toBe(14);
    expect(s.t).toBe(Date.parse("2026-11-18T10:30:15Z"));
  });

  it("buildShareUrl: origen + ruta + hash, sin parámetros de depuración", () => {
    const url = buildShareUrl(
      { origin: "https://pulso.example", pathname: "/" },
      { mode: "replay", t: NOW - DAY, speed: 1 },
    );
    expect(url).toBe("https://pulso.example/#v=1&m=r&t=2026-11-18T12:00Z&s=1");
  });

  it("la lista local de capas coincide con el contrato", () => {
    expect([...SHARE_LAYER_IDS]).toEqual([...LAYER_IDS]);
  });
});

describe("URL compartible: valores inválidos y hostiles", () => {
  it("hash vacío, sin '#' útil o solo ruido → estado por defecto", () => {
    for (const h of ["", "#", "#&&&", "#=1", "#foo", "#v=1&&=&c", "garbage"]) {
      expect(parse(h)).toEqual({ mode: "view" });
    }
  });

  it("versión desconocida: se ignora todo", () => {
    expect(parse("#v=2&c=43.37,-8.4,14,0,0&m=r")).toEqual({ mode: "view" });
    expect(parse("#v=abc&m=r")).toEqual({ mode: "view" });
  });

  it("cadenas enormes se descartan sin procesarse", () => {
    expect(parse(`#v=1&m=r&t=${"9".repeat(MAX_HASH_LENGTH * 10)}`)).toEqual({ mode: "view" });
    expect(parse(`#v=1&l=${"bus,".repeat(5000)}`)).toEqual({ mode: "view" });
  });

  it("cámara con NaN, Infinity, texto o número de campos incorrecto: se ignora entera", () => {
    for (const c of [
      "NaN,NaN,NaN,NaN,NaN",
      "43.3,-8.4,Infinity,0,0",
      "43.3,-8.4,14,0",
      "43.3,-8.4,14,0,0,1",
      "a,b,c,d,e",
      "43.3,-8.4,1e3,0,0",
      "43.3,-8.4,14,0,<script>",
      "",
    ]) {
      expect(parse(`#v=1&c=${c}`).camera).toBeUndefined();
    }
  });

  it("cámara fuera de rango: se acota; el rumbo se normaliza", () => {
    const cam = parse("#v=1&c=90,-180,99,540,89").camera;
    expect(cam).toEqual({
      lat: CAMERA_LIMITS.lat[1],
      lon: CAMERA_LIMITS.lon[0],
      zoom: CAMERA_LIMITS.zoom[1],
      bearing: 180,
      pitch: CAMERA_LIMITS.pitch[1],
    });
    expect(parse("#v=1&c=43.3,-8.4,1,-190,-5").camera).toMatchObject({
      zoom: CAMERA_LIMITS.zoom[0],
      bearing: 170,
      pitch: 0,
    });
  });

  it("capas: solo las del contrato; lo desconocido se descarta; sin ninguna válida, se ignora", () => {
    expect(parse("#v=1&l=bus,nave,__proto__,bike,bus,<img>").layers).toEqual(["bus", "bike"]);
    expect(parse("#v=1&l=foo,bar").layers).toBeUndefined();
    expect(parse("#v=1&l=").layers).toBeUndefined();
  });

  it("t, s y p solo cuentan en modo Reproducir", () => {
    expect(parse("#v=1&t=2026-11-18T10:30Z&s=60&p=1")).toEqual({ mode: "view" });
  });

  it("modos desconocidos o reservados (Escuchar) caen a Ahora", () => {
    expect(parse("#v=1&m=e")).toEqual({ mode: "view" });
    expect(parse("#v=1&m=javascript:alert(1)")).toEqual({ mode: "view" });
  });

  it("velocidades: solo 1, 60 y 600", () => {
    expect(parse("#v=1&m=r&s=60").speed).toBe(60);
    for (const s of ["2", "0", "-1", "6e1", "60.0", "abc", "1e3", "NaN"]) {
      expect(parse(`#v=1&m=r&s=${s}`).speed).toBeUndefined();
    }
  });

  it("instantes: futuro, más de 30 días, formato raro o fecha imposible → se ignoran", () => {
    const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 16) + "Z";
    expect(parse(`#v=1&m=r&t=${iso(NOW + DAY)}`).t).toBeUndefined();
    expect(parse(`#v=1&m=r&t=${iso(NOW - 31 * DAY)}`).t).toBeUndefined();
    expect(parse(`#v=1&m=r&t=${iso(NOW - 2 * DAY)}`).t).toBeDefined();
    for (const t of [
      "9999999999999",
      "2026-11-18",
      "2026-11-18T10:30",
      "2026-11-18T10:30+01:00",
      "2026-02-31T10:30Z",
      "2026-13-01T10:30Z",
      "2026-11-18T25:30Z",
      "NaN",
      "<b>",
    ]) {
      expect(parse(`#v=1&m=r&t=${t}`).t).toBeUndefined();
    }
    // Se sigue entrando en Reproducir con la hora por defecto.
    expect(parse("#v=1&m=r&t=nope").mode).toBe("replay");
  });

  it("un instante a segundos del futuro (reloj atrasado) se acota a «ahora»", () => {
    expect(parse(`#v=1&m=r&t=2026-11-19T12:02Z`).t).toBe(NOW);
  });

  it("claves repetidas: gana la primera; percent-encoding roto no lanza", () => {
    expect(parse("#v=1&m=r&s=60&s=600").speed).toBe(60);
    expect(() => parse("#v=1&c=%E0%A4%A&m=%")).not.toThrow();
    expect(parse("#v=1&c=%E0%A4%A").camera).toBeUndefined();
  });

  it("no hay inyección: lo que se escribe solo contiene caracteres seguros", () => {
    const hash = serializeShareState({
      mode: "replay",
      layers: ["bus", "<script>" as never],
      camera: { lat: Number.NaN, lon: 0, zoom: 1, bearing: 0, pitch: 0 },
      t: NOW,
      speed: 7 as never,
    });
    expect(hash).toMatch(/^[#A-Za-z0-9=&,.:-]*$/);
    expect(hash).toBe("#v=1&l=bus&m=r&t=2026-11-19T12:00Z");
  });
});
