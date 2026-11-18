# ADR 0002 — Herramientas de calidad

- Estado: aceptada (T1.1)
- Decisión: ESLint 10 (flat config, `typescript-eslint` strict, `no-explicit-any` en error) + Prettier (+ `eslint-config-prettier`) + Vitest, ejecutados con `pnpm -r` y en CI (GitHub Actions).
- Por qué: estándar del ecosistema TS/Vite, cero configuración por paquete, rápido.
- Consecuencias: `packages/schema/src/index.ts` y `.claude/` quedan fuera de Prettier para no tocar el contrato ni los hooks. CI exige typecheck, lint, test y `format:check`.
