---
name: new-adapter
description: Crear un adaptador de datos nuevo (bus, bici, meteo, aire, mar, barcos, aviones) con fixtures grabadas y tests. Úsalo al implementar cualquier adaptador (M3.1–M3.4, M5.1).
---
# Nuevo adaptador

1. Lee `docs/sources/<fuente>.md`; si no existe, aplica antes la skill `source-note`.
2. Crea `packages/adapters/<fuente>/` con `index.ts`, `fixtures/` y `index.test.ts`.
3. Implementa la interfaz `Adapter<T>` de `@pulso/schema`: `fetch` (crudo, con `AbortSignal`, timeout y User-Agent identificable) y `parse` (puro, sin red).
4. Graba UNA respuesta real en `fixtures/` (sin claves ni datos personales) y testea `parse` contra ella: casos normal, vacío y campo ausente.
5. Valida la salida con el esquema; tiempos en UTC epoch ms; descarta registros sin coordenadas válidas (A Coruña ≈ lon -8.6…-8.3, lat 43.3…43.45, salvo barcos/aviones).
6. Respeta el límite de peticiones de la fuente (`intervalMs`); nunca llames a la API real desde los tests.
7. Añade la fila de estado a `source_health` cuando exista el servicio de ingesta.
