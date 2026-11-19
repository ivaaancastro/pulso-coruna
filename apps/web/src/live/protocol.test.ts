import { describe, expect, it } from "vitest";
import { parseWsMessage } from "./protocol";
import { bus, delta, snapshot, station } from "./test-helpers";

describe("parseWsMessage", () => {
  it("acepta snapshot y delta válidos", () => {
    const s = parseWsMessage(JSON.stringify(snapshot({ bus: [bus("a")], bike: [station("s")] })));
    expect(s.ok && s.message.type).toBe("snapshot");
    const d = parseWsMessage(JSON.stringify(delta("bus", [bus("a")], ["b"])));
    expect(d.ok && d.message.type).toBe("delta");
  });

  it("rechaza lo que no es texto o no es JSON", () => {
    expect(parseWsMessage(new ArrayBuffer(4)).ok).toBe(false);
    expect(parseWsMessage("{no json").ok).toBe(false);
  });

  it("rechaza versión distinta, tipo desconocido y claves extra", () => {
    expect(parseWsMessage(JSON.stringify({ ...snapshot({}), v: 2 })).ok).toBe(false);
    expect(parseWsMessage(JSON.stringify({ v: 1, type: "ping" })).ok).toBe(false);
    expect(parseWsMessage(JSON.stringify({ ...snapshot({}), extra: 1 })).ok).toBe(false);
  });

  it("rechaza elementos que no corresponden a su capa o con datos fuera de rango", () => {
    expect(parseWsMessage(JSON.stringify(delta("bike", [bus("a")]))).ok).toBe(false);
    expect(parseWsMessage(JSON.stringify(delta("bus", [bus("a", { lat: 200 })]))).ok).toBe(false);
    // ts en segundos (error típico de las fuentes).
    expect(parseWsMessage(JSON.stringify(delta("bus", [bus("a", { ts: 1_760_000_000 })]))).ok).toBe(
      false,
    );
  });
});
