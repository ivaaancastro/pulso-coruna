---
name: perf-budget
description: Medir rendimiento de la web (fps, LCP, INP, peso de JS, peticiones a terceros) contra los presupuestos de docs/ROADMAP.md. Úsalo en cualquier PR que toque apps/web, render, capas o dependencias del frontend.
---
# Presupuesto de rendimiento

1. Lee la tabla «Presupuestos de rendimiento» de `docs/ROADMAP.md`.
2. Build de producción de `apps/web` (`pnpm --filter <nombre del paquete web> build`) y sirve el build de producción (nunca midas el servidor de desarrollo).
3. Con el MCP de chrome-devtools: emula 390×844, CPU 4× más lenta y red «Fast 4G».
4. Traza la carga en frío: tiempo hasta `performance.mark('map:first-frame')` (LCP no cuenta el canvas WebGL), JS inicial transferido (gzip), peticiones a dominios que no sean el nuestro (deben ser 0).
5. Traza 10 s con todas las capas activas (y la intro si aplica): fps medio y p5, tareas largas > 50 ms, tiempo de script por fotograma en el hilo principal.
6. INP: lanza las interacciones clave (tocar una entidad, cambiar de modo, arrastrar la línea temporal) y mide la peor.
7. Lighthouse (rendimiento, accesibilidad, buenas prácticas) y PWA a mano: manifest válido, service worker registrado, funciona sin conexión, instalable en Chrome.
8. Entrega una tabla métrica | presupuesto | medido | ✅/❌ y, por cada ❌, la causa probable con la traza. Pega la tabla en la PR. Si algo se pasa, la tarea no está hecha.
