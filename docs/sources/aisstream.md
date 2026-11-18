# aisstream.io (barcos, AIS)

- **Verificado:** 2026-11-18 (UTC), solo lectura de documentación: <https://aisstream.io/documentation> y <https://aisstream.io/>. **No se creó cuenta ni clave y no se abrió el WebSocket: no hay muestra real.**
- **Endpoint:** `wss://stream.aisstream.io/v0/stream`.
- **Acceso:** requiere clave de API. La web dice «Sign in with GitHub and create an API key in Account». Crearla es una acción humana (cuenta y clave: pendiente). La clave irá en `.env` (`AISSTREAM_API_KEY`; añadir a `.env.example` al hacer el adaptador), nunca en el repo.
- **Navegador:** conexión directa desde el navegador no permitida («Direct browser connections are not permitted»). Encaja con la regla del proyecto: solo conecta el servidor.
- **Protocolo:** tras abrir, enviar en ≤ 3 s una suscripción JSON: `APIKey`, `BoundingBoxes` (pares de esquinas `[lat, lon]`), opcional `FiltersShipMMSI` (≤ 200) y `FilterMessageTypes`. Reenviar reemplaza la suscripción (máx. 1 por segundo). Responde `SubscriptionConfirmation`. Mensajes: tramas binarias con JSON UTF-8. Se recomienda `permessage-deflate`.
- **Límites (documentación):** 3 conexiones suscritas por cuenta y 3 abiertas por IP; si no se lee rápido se descartan mensajes; desde septiembre de 2026 las conexiones sin compresión tienen límite de ancho de banda; **sin SLA ni reenvío** («no SLA or uptime guarantee, and events are not durably replayed»). Reconectar con backoff exponencial.
- **Licencia / términos:** no localizada. `/privacy`, `/terms` y `/tos` devolvieron 404; el pie enlaza «Privacy» y «Support», no leídos. La portada dice «for free». **Pendiente de decisión humana** (uso, redistribución, atribución, y si un producto público con reproducción histórica es admisible).
- **Frecuencia:** orientada a eventos (cada barco emite según velocidad/estado); **no medida**.

## Zona A Coruña (propuesta)

`BoundingBoxes: [[[43.25, -8.65], [43.50, -8.20]]]` (esquinas lat/lon; cubre bahía, puerto interior, Langosteira y la entrada). Filtrar a `PositionReport`, `StandardClassBPositionReport`, `ExtendedClassBPositionReport` y `ShipStaticData` (nombre, tipo, dimensiones). Ajustar tras ver tráfico real.

## Muestra

La de la documentación oficial (no capturada por nosotros; datos de ejemplo de Miami):

```json
{
  "MessageType": "PositionReport",
  "MetaData": {
    "MMSI": 368207620,
    "ShipName": "EXAMPLE VESSEL",
    "Latitude": 25.7617,
    "Longitude": -80.1918
  },
  "Message": {
    "PositionReport": {
      "MessageID": 1,
      "UserID": 368207620,
      "Sog": 12.4,
      "Cog": 86.7,
      "TrueHeading": 87,
      "Valid": true
    }
  }
}
```

La documentación no lista un campo de hora en `MetaData`. Con tráfico real hay que comprobar si existe (en la práctica suele venir `time_utc`, sin verificar) o si se usa la hora de recepción.

## Mapeo a `packages/schema`

`Entity`, `layer: "ship"`:

- `id`: MMSI como string.
- `lon`/`lat`: `MetaData.Longitude`/`Latitude`.
- `heading`: `TrueHeading` (0–359; **511 = no disponible** en AIS: usar `Cog` u omitir).
- `speed`: `Sog` en **nudos** → m/s (× 0,514444). `Sog` 102,3 = no disponible en AIS.
- `ts`: hora del mensaje en epoch ms UTC (si hay campo) o de recepción.
- `meta`: `name` (ShipName), `shipType` (de `ShipStaticData`), `navStatus`.

## Riesgos

- Clave/cuenta (GitHub) y términos pendientes; dependencia de un servicio gratuito sin SLA.
- Cobertura terrestre: huecos mar adentro; pérdida de mensajes si el consumidor es lento.
- El MMSI de embarcaciones de recreo puede asociarse a una persona; valorar no exponerlo (hash, o solo tipo/nombre) antes de publicar. Decisión humana.
- Los límites cambian (ya hay uno anunciado para septiembre de 2026); releer la documentación antes del adaptador.
