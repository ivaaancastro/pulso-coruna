# ADR-0018: API con Fastify 5, @fastify/websocket y @fastify/cors

- Fecha: 2026-11-19
- Estado: aceptada

## Contexto

`apps/api` debe servir REST + WebSocket (AGENTS.md: Fastify) con pocas dependencias y empaquetable en una imagen mínima (ADR-0017).

## Decisión

Versiones exactas, comprobadas en npm y con Context7 (API de `websocket: true` en rutas y `preValidation` para rechazos previos al handshake): `fastify` 5.12.8, `@fastify/websocket` 11.3.7 (trae `ws`), `@fastify/cors` 11.4.3; `postgres` 4.1.1 reutiliza ADR-0015. DevDependencies: `@types/ws` 8.18.2 (tipos del socket), `@types/node` y `esbuild` como en la ingesta. Los tests usan el `WebSocket` global de Node (sin `ws` directo). Bundle con esbuild + banner `createRequire` (Fastify/pino usan `require`).

## Alternativas

`ws` a pelo con `http`: menos dependencias pero reimplementa rutas, hooks, logging y CORS. Express/Hono: sin ganancia frente a Fastify, que ya fija AGENTS.md. `@fastify/rate-limit`: no hace falta para el límite de conexiones WS (contador propio, ~30 líneas).

## Consecuencias

Bundle de ~2,7 MB, imagen sin `node_modules`. Al subir de versión mayor de Fastify hay que revisar los plugins `@fastify/*` a la vez.
