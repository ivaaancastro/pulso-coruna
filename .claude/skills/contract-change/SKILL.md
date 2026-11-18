---
name: contract-change
description: Modificar tipos o endpoints del contrato (packages/schema, /api/v1) sin romper adaptadores, API ni web. Úsalo siempre que cambie Entity, StationStatus, Observation o el mensaje WebSocket.
---
# Cambio de contrato

1. Propón el cambio y su motivo; ¿es compatible hacia atrás? Si no, nueva versión (`v2`), nunca romper `v1`.
2. Escribe un ADR corto en `docs/ADR/`.
3. Actualiza `packages/schema` y sus tests primero.
4. Ejecuta `pnpm -r typecheck && pnpm -r test`: deben pasar todos los adaptadores y la API.
5. Actualiza la sección «Contratos» de `docs/SPEC.md`.
6. Avisa en el resumen de la PR de que toca el contrato.
