# ADR-0008: apps/web con Vite y TypeScript sin framework

- Fecha: 2026-11-18
- Estado: aceptada

## Contexto

M2.4 crea `apps/web`. El shell (hora, índice, selector de modo) es pequeño y el peso inicial de JS debe quedar muy por debajo de 250 KB gzip (ROADMAP).

## Decisión

Vanilla TypeScript con `vite` ^8.3.8 (dev server y build; `vitest` ya está en la raíz) y `jsdom` ^31.0.1 (solo tests del selector de modo). Sin framework: el estado de la UI es mínimo y MapLibre/deck.gl (M2.2) manejan su propio canvas. Cadenas en `src/i18n/` sin librería (es, gl, en). Archivo (OFL 1.1) autoalojada en `public/fonts/` desde `@fontsource-variable/archivo` 5.3.0, copiada al repo, no como dependencia.

## Alternativas

React/Preact/Solid: sin necesidad hoy; reevaluar con ADR si la UI crece (M4/M6). `i18next`: excesivo para tres idiomas con claves planas.

## Consecuencias

Los componentes son funciones que crean DOM; sin reactividad. Migrar a un framework exigirá reescribir tres componentes. Fuente de ~90 KB sin subsetear (M2.5 puede reducirla).
