import { describe, expect, it } from "vitest";
import { parseFeatures } from "./features-parse";

describe("parseFeatures", () => {
  it("apaga todo por defecto", () => {
    for (const raw of [undefined, null, "", " , "]) {
      expect(Object.values(parseFeatures(raw)).every((v) => !v)).toBe(true);
    }
  });

  it("activa las listadas, tolerando espacios y mayúsculas", () => {
    expect(parseFeatures(" Listen , replay ")).toEqual({
      listen: true,
      replay: true,
      pulse: false,
      clip: false,
      share: false,
    });
  });

  it("ignora nombres desconocidos", () => {
    expect(parseFeatures("foo,share").share).toBe(true);
    expect(parseFeatures("foo").listen).toBe(false);
  });

  it("el clip exige el índice Pulso", () => {
    expect(parseFeatures("clip").clip).toBe(false);
    expect(parseFeatures("clip,pulse").clip).toBe(true);
  });

  it("all activa todo", () => {
    expect(Object.values(parseFeatures("all")).every(Boolean)).toBe(true);
  });
});
