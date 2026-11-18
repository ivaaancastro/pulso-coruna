import { test, expect } from "@playwright/test";

// Presupuesto: 0 peticiones del navegador a orígenes distintos al nuestro (AGENTS.md).
test("0 peticiones a terceros durante carga e interacción", async ({ page, context, baseURL }) => {
  const own = new URL(baseURL ?? "http://127.0.0.1:4173").origin;
  const foreign: string[] = [];
  let total = 0;

  // A nivel de contexto: también cubre workers y service workers.
  context.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") return;
    total += 1;
    if (url.origin !== own) foreign.push(`${req.method()} ${req.url()}`);
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // Recorre los controles visibles del shell: cualquier modo no debe llamar fuera.
  for (const button of await page.getByRole("button").all()) {
    await button.click({ timeout: 2_000 }).catch(() => undefined);
  }
  await page.waitForTimeout(1_000);

  expect(total, "la página debe haber hecho peticiones propias").toBeGreaterThan(0);
  expect(foreign, `peticiones a terceros:\n${foreign.join("\n")}`).toEqual([]);
});
