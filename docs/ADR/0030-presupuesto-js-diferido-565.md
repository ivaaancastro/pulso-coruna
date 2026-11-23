# ADR-0030: presupuesto del JS diferido a 565 KB

Estado: aceptada. Fecha: 2026-11-23. Amplía ADR-0021 (560 KB).

- **Contexto:** M8.5 añade el chunk del clip (~2,1 KB gzip, solo se descarga al pulsar) y el JS diferido queda en 560,5 KB. Se intentó recortar sin quitar funciones y solo se ahorraron ~0,1 KB.
- **Decisión:** `mapChunkGzipMaxKB` pasa de 560 a 565 (decisión del humano, opción «subir con ADR»). No se crea un presupuesto aparte para chunks a petición.
- **Consecuencias:** margen de ~4,6 KB. Todo código nuevo sigue en chunk propio y se mide con `pnpm perf:bundle`; otra subida exige ADR nuevo y valorar presupuesto por chunks a petición o carga por capa.
