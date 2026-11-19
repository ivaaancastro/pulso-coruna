# ADR-0023: fuentes WebSocket como colector con lote periódico

- Fecha: 2026-11-19
- Estado: aceptada

## Contexto

aisstream.io (barcos) es un WebSocket de larga duración, no un sondeo. El planificador de ingesta solo conoce `fetch`/`parse` cíclicos (`Adapter`).

## Decisión

El contrato `Adapter` no cambia. El adaptador crea un colector que mantiene la conexión (backoff exponencial con jitter, watchdog de silencio) y un estado en memoria por barco; `fetch` abre el colector la primera vez, purga barcos callados y devuelve las posiciones nuevas desde el ciclo anterior; `parse` es puro. Si lleva más de 5 min sin señal sana (desconexión, clave inválida o socket mudo), `fetch` falla y `source_health` se degrada. Único cambio en ingesta: `IngestAdapter` admite un `close()` opcional que `main.ts` llama al apagar. Sin dependencias de runtime: WebSocket global de Node 22+ y `node:crypto` (hash SHA-256 con sal del MMSI). Solo `@types/node` 24.19.2 (la versión ya usada por ingesta y API) como devDependency de `@pulso/adapters`, para tipar `node:crypto`.

## Alternativas

Un tipo de adaptador «stream» con su propio bucle en el planificador: más código y más tipos para una sola fuente. Un proceso aparte: complica el despliegue.

## Consecuencias

Un lote que falla al escribir en BD se pierde (el barco reaparece con su siguiente mensaje). El estado vive en memoria: tras un reinicio se rellena en minutos.
