# ADR-0021: presupuesto del JS diferido a 560 KB y medición completa

Estado: aceptada. Fecha: 2026-11-19. Sustituye el límite de 450 KB del ROADMAP (ver ADR-0007 y ADR-0011).

- **Contexto:** al añadir la primera capa deck.gl (M4.4/M4.5) el JS diferido pasa de ~420 a ~500 KB gzip. Casi todo es el coste fijo de tener cualquier capa (clase `Layer`, luma `engine`/`gpgpu`, `debug-hooks`), no de una capa concreta. Además `check-bundle.mjs` solo contaba los chunks cuyo nombre casaba con `mapChunkPattern`, así que no veía los chunks de capas y marcaba OK por error.
- **Decisión:** `check-bundle.mjs` mide ahora todo el JS que no es inicial ni service worker ni worker (`excludeChunkPattern` en `perf-budget.json`); el límite sube a 520 KB (540 KB tras la capa bus, 527,7 KB: M4.3b; 560 KB tras las capas de M5: marea, barcos, aire y aviones, ~546 KB) (`mapChunkGzipMaxKB`) y el ROADMAP se actualiza. El JS inicial sigue en 250 KB.
- **Consecuencias:** un chunk nuevo cuenta sin tocar la configuración. M4.3 (bus) y futuras capas deben caber en el margen restante; si no, ADR nuevo o carga por capa. Revisar al llegar a M5.
