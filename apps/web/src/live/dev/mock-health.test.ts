import { describe, expect, it } from "vitest";
import { parseHealthReport } from "../../status/model";
import { parseHealth } from "../health";
import { handleMockHealth } from "./mock-health";

const NOW = Date.parse("2026-11-20T10:00:00Z");

describe("health simulado", () => {
  it("lo entienden el lector de capas y el del panel, con estados variados", () => {
    const { status, body } = handleMockHealth({ now: NOW });
    expect(status).toBe(200);
    expect(parseHealth(body)?.bus).toBe(NOW - 15_000);
    const report = parseHealthReport(body);
    expect(report?.ts).toBe(NOW);
    const states = new Set([...(report?.sources.values() ?? [])].map((s) => s.status));
    expect(states).toEqual(new Set(["ok", "degraded", "down"]));
    expect(report?.sources.has("itranvias")).toBe(false);
  });
});
