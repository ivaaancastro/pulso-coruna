# ADR-0019: el stream WS se alimenta por sondeo de la BD con diff en memoria

- Fecha: 2026-11-19
- Estado: aceptada

## Contexto

La ingesta y la API son procesos distintos que solo comparten TimescaleDB. La API debe emitir deltas cuando cambian los datos grabados.

## Decisión

Mientras haya algún cliente WS, la API consulta cada `API_POLL_MS` (2 s) el último estado de las tres tablas, lo compara con el estado en memoria y emite un `delta` por capa con cambios; el snapshot de un cliente nuevo sale de ese mismo estado. Sin clientes no consulta nada y descarta el estado. Un sondeo fallido se registra y se reintenta; el estado se conserva.

## Alternativas

`LISTEN/NOTIFY` desde la ingesta: latencia menor, pero acopla la ingesta a la API (trigger o `NOTIFY` en cada lote), no aporta el diff (habría que releer igualmente), exige una conexión dedicada que reconectar y no ayuda en el arranque en frío. No compensa con fuentes que se actualizan cada 30–600 s. Streaming desde el proceso de ingesta (un solo proceso): acopla despliegues y rompe la separación grabar/servir.

## Consecuencias

Latencia máxima de ~2 s sobre lo grabado (sin importancia: las fuentes van a decenas de segundos). Coste constante y pequeño de BD, independiente del número de clientes (un sondeo compartido). Si algún día hace falta menos latencia o más fuentes, `LISTEN/NOTIFY` puede despertar el sondeo sin cambiar el contrato.
