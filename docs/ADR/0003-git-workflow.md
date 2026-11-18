# ADR 0003 — Flujo de ramas y SDD

- Estado: aceptada
- Decisión: `main` (releases, protegida) ← `develop` (integración, protegida) ← ramas `feat|fix|…/<ID>-<slug>` vía PR. Desarrollo guiado por spec (`docs/specs/`).
- Por qué: historial limpio, `main` siempre desplegable, revisión cruzada obligatoria.
- Consecuencias: ver `docs/WORKFLOW.md`. CI rechaza PR a `main` que no vengan de `develop`.
