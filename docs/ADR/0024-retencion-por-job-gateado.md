# ADR-0024: retención de brutos por job de la ingesta, gateado por el agregado

- Fecha: 2026-11-19
- Estado: aceptada (sustituye la política `add_retention_policy` de la migración 0002)

## Contexto

La política de retención de Timescale borra chunks sin comprobar que los agregados `*_1m` los hayan cubierto: si el refresco se retrasa o la ingesta/BD estuvo parada, se pierde el histórico a 1/min. Además `drop_chunks` invalida el rango borrado en el agregado: refrescarlo después lo vacía.

## Decisión

Se mantienen los agregados continuos `positions_1m`, `station_status_1m` y `observations_1m` (última muestra del minuto). La migración 0003 quita las políticas de retención; `apps/ingest/src/db/retention.ts` ejecuta cada hora (`RETENTION_INTERVAL_MS`): refresco del agregado en `[primer bruto existente, corte)` y, solo si salió bien, `drop_chunks(older_than => corte)`. Idempotente, se pone al día solo y no corre dos veces a la vez (advisory lock). Estado en `retention_status`. Sin dependencias nuevas.

## Consecuencias

Los brutos duran entre `RETENTION_RAW_DAYS` y esa cifra + el tamaño del chunk (1 o 7 días); la consulta de histórico usa el corte, no el chunk. Si la ingesta está parada, los brutos se acumulan en lugar de perderse.
