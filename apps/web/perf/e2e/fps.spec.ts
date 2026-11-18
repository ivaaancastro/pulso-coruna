import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

interface FpsBudget {
  avgMin: number;
  p5Min: number;
  mapFirstFrameMaxMs: number;
}
interface Budget {
  fps: { durationMs: number; ci: FpsBudget; gpu: FpsBudget };
}

const budget = JSON.parse(
  readFileSync(new URL("../../perf-budget.json", import.meta.url), "utf8"),
) as Budget;
const profile = process.env.PERF_FPS_PROFILE === "gpu" ? "gpu" : "ci";
const limits = budget.fps[profile];

// Fotogramas durante `durationMs` con requestAnimationFrame. Contra el shell actual mide la salud
// del hilo principal; con mapa (M2.2) mide el canvas porque rAF avanza al ritmo del render.
test(`fps (${profile}): media >= ${limits.avgMin}, p5 >= ${limits.p5Min}`, async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Si el mapa existe, espera su primer fotograma (performance.mark('map:first-frame')).
  const hasMap = await page.evaluate(() => document.querySelector("#map canvas, canvas") !== null);
  if (hasMap) {
    await page.waitForFunction(
      () => performance.getEntriesByName("map:first-frame").length > 0,
      null,
      {
        timeout: limits.mapFirstFrameMaxMs * 2,
      },
    );
    const firstFrame = await page.evaluate(
      () => performance.getEntriesByName("map:first-frame")[0]?.startTime ?? Infinity,
    );
    test
      .info()
      .annotations.push({ type: "map:first-frame", description: `${Math.round(firstFrame)} ms` });
    expect(firstFrame, "primer fotograma del mapa").toBeLessThan(limits.mapFirstFrameMaxMs);
  }

  const result = await page.evaluate(async (durationMs) => {
    const deltas: number[] = [];
    await new Promise<void>((resolve) => {
      let last = performance.now();
      const start = last;
      const tick = (now: number) => {
        deltas.push(now - last);
        last = now;
        if (now - start < durationMs) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    deltas.shift(); // el primer intervalo incluye el arranque
    const fps = deltas.map((d) => 1000 / d).sort((a, b) => a - b);
    const avg = deltas.length / (deltas.reduce((a, b) => a + b, 0) / 1000);
    return { avg, p5: fps[Math.floor(fps.length * 0.05)] ?? 0, frames: deltas.length };
  }, budget.fps.durationMs);

  const line = `fps ${profile}: avg=${result.avg.toFixed(1)} p5=${result.p5.toFixed(1)} frames=${result.frames} map=${hasMap}`;
  console.log(line);
  test.info().annotations.push({ type: "fps", description: line });
  expect(result.avg, line).toBeGreaterThanOrEqual(limits.avgMin);
  expect(result.p5, line).toBeGreaterThanOrEqual(limits.p5Min);
});
