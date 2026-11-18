# ADR-0006: zod en @pulso/schema

- Fecha: 2026-11-18
- Estado: aceptada

## Contexto

El contrato (Entity, StationStatus, Observation, mensajes WS) se valida en runtime y los tipos se derivan con `z.infer`.

## Decisión

`zod` 4.6.7 exacta (Context7 no disponible; verificada con npm y tests). `z.strictObject`; WS v1 con `z.discriminatedUnion('type')`; `ts` entero epoch ms > 1e11 (rechaza segundos). Capa→tipo: bus/ship/plane/train→Entity, bike→StationStatus, weather/air/sea→Observation, validado en snapshot y delta. Identidad: `id`; Observation `stationId:metric` (la usan los `removes`).

## Alternativas

Valibot, TypeBox o solo tipos TS: descartadas por falta de validación runtime o menor ecosistema.

## Consecuencias

Una dependencia; claves desconocidas rechazadas, así que ampliar el contrato exige subir `v`.
