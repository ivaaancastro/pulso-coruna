# ADR-0006: zod en @pulso/schema

- Fecha: 2026-11-18
- Estado: aceptada

## Contexto

El contrato (Entity, StationStatus, Observation, mensajes WS) debe validarse en runtime en adaptadores, API y web, y mantener los tipos en sincronía.

## Decisión

Añadir `zod` 4.6.7 (versión exacta, estable `latest` en npm; Context7 no disponible, API comprobada en tests) a `@pulso/schema`. Tipos derivados con `z.infer`. Objetos `z.strictObject` (la unión de elementos WS no descarta claves). Mensajes WS con `z.discriminatedUnion('type')` y `v: z.literal(1)`.

## Alternativas

Valibot, TypeBox, tipos TS sin validación runtime.

## Consecuencias

Una dependencia más (única); claves desconocidas rechazadas, así que ampliar el contrato exige cambio de schema (skill `contract-change`). `ts` solo se valida como entero positivo: no se distingue segundos de ms.
