# AGENTS.md — Pulso A Coruña

Fuente de verdad para cualquier agente (Claude Code, opencode…). Spec completa: `docs/SPEC.md`. Tareas: `docs/TASKS.md`.

## Qué es
Web que muestra A Coruña como un organismo vivo: buses, BiciCoruña, viento, mareas, barcos, aire y aviones sobre un mapa 3D, con modo Reproducir (máquina del tiempo) y Escuchar (sonificación), más un índice Pulso (0–100). PWA primero, iOS después. Objetivo: portfolio/reputación, sin monetización.

## Stack
pnpm workspaces · TypeScript estricto · Vite · MapLibre GL + deck.gl · Fastify (REST + WebSocket) · PostgreSQL/TimescaleDB · Docker Compose + Caddy · Vitest.

## Comandos (ajustar cuando existan)
- Instalar: `pnpm install`
- Test: `pnpm -r test`
- Lint: `pnpm -r lint`
- Tipos: `pnpm -r typecheck`
- Build: `pnpm -r build`

## Convenciones
- TypeScript estricto, sin `any`. Commits convencionales.
- Tiempos siempre en UTC, epoch ms. Zona `Europe/Madrid` solo al mostrar.
- Todo dato externo se normaliza a `Entity` | `StationStatus` | `Observation` (`packages/schema`).
- El navegador nunca llama a fuentes externas; solo a nuestra API (y tesela PMTiles propias).

## Definición de hecho
Tests verdes, typecheck sin errores, docs/ADR actualizados si cambia una decisión, resumen de cambios + riesgos + cómo probarlo.

## Prohibido
- Añadir dependencias sin ADR corto en `docs/ADR/`.
- Tocar `packages/schema` sin avisar (cambio de contrato → tests de todos los adaptadores y la API).
- Escribir claves/secretos en el repo (usar `.env`, ver `.env.example`).
- Llamar a APIs reales desde tests (usar fixtures en `packages/adapters/<fuente>/fixtures/`).
- Elegir licencias/términos de uso de fuentes ni contactar con terceros: lo decide el humano.

## Método
1. Una tarea = una rama = una PR (tamaño máx. media jornada).
2. Leer la sección relevante de la spec y proponer plan breve antes de tocar archivos.
3. Un git worktree por tarea y agente para paralelizar (`git worktree add ../pulso-T1.4 -b feat/T1.4`).
4. Revisión cruzada: lo que escribe un agente lo revisa el otro.
5. ADR de ≤10 líneas por decisión técnica relevante.
