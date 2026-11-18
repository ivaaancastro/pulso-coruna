# iTranvías (posiciones de buses, API no oficial)

**Verificado:** 2026-11-18 (UTC), con 10 peticiones GET en total (ver «Cómo se midió»).
**Estado:** API no documentada ni oficial; es el backend de la web `https://itranvias.com/`. No hay documentación pública ni contrato de uso.

## Acceso

Sin clave, sin cookies, sin autenticación (ningún endpoint pidió login). La web (`js/main.js`, `js/Objects/MapaItranvias_obj.js`) llama a un único script PHP:

```
GET https://itranvias.com/queryitr_v3.php?dato=<parámetro>&func=<función>
```

Funciones observadas en el JS público de la web:

| func | dato                                   | Devuelve                                                                    |
| ---- | -------------------------------------- | --------------------------------------------------------------------------- |
| 7    | `20160101T000000_es_0_20160101T000000` | Catálogo completo: líneas, paradas (con lon/lat), enlaces, precios          |
| 99   | `<id interno de línea>&mostrar=B`      | **Posición GPS de los buses en servicio de esa línea** (lo que nos importa) |
| 99   | `<id interno de línea>&mostrar=PRB`    | Paradas y buses de la línea (la web lo usa para pintar el mapa)             |
| 3, 8 | posición / parámetros de parada        | Paradas cercanas, tiempos de llegada (no probados; fuera de alcance)        |

- `func=7` (76 KB, una vez): 26 líneas, 537 paradas. Los ids internos de línea no son el número comercial: `100`=línea 1, `1900`=1A, `200`=2, `800`=2A, `300`=3, `301`=3A, `400`=4, `500`=5, `600`=6, `601`=6A, `700`=7, `1100`=11, `1200`=12, `1500`=12A, `1400`=14, `1700`=17, `2000`=20, `2100`=21, `2200`=22, `2300`=23, `2301`=23A, `2400`=24, `1800`/`1801`=BUH, `2450`/`2451`=UDC. Usar el id comercial (`dato=1`) devuelve `"mapas":[[]]` (vacío, sin error).
- Para cubrir toda la flota hay que pedir `func=99` **una vez por línea** (26 peticiones por ciclo). Esto no se probó (carga innecesaria); solo se midió la línea 100.
- Cabecera: `Content-Type: text/html` aunque el cuerpo es JSON; servidor Apache. El cuerpo incluye `"Origen":"Web_Beta"`.
- La web refresca los buses cada **15 s** (`setTimeout(..., 15000)` en `ajaxBuses`), es decir, ese es el ritmo «aceptado» de uso por un cliente oficial.

## Respuesta de ejemplo real (línea 1, `dato=100&mostrar=B&func=99`, 11:41:24 UTC)

```json
{
  "resultado": "OK",
  "fecha_peticion": "20261118124123",
  "peticion": "jmapas?linea=100&mostrar=b",
  "tamaño": 316,
  "mapas": [
    {
      "buses": [
        {
          "sentido": "0",
          "buses": [
            { "bus": 420, "posx": -8.390067, "posy": 43.36794 },
            { "bus": 421, "posx": -8.405512, "posy": 43.362667 }
          ]
        },
        { "sentido": "1", "buses": [{ "bus": 435, "posx": -8.399558, "posy": 43.347787 }] }
      ]
    }
  ],
  "Origen": "Web_Beta"
}
```

Sin servicio: `"mapas":[[]]` (HTTP 200). `posx` = longitud, `posy` = latitud (WGS84). `fecha_peticion` = hora del servidor en formato `YYYYMMDDHHMMSS` en hora local (`Europe/Madrid`: 12:41 local = 11:41 UTC), **no** es la hora de la posición del bus.

## Frecuencia de actualización (medida)

Línea 100, 3 lecturas a 11:41:24, 11:41:44 y 11:41:59 UTC (intervalos ≈20 s y ≈15 s):

- Bus 421: cambió de posición en las tres lecturas (-8.405512 → -8.405462 → -8.404822; 43.362667 → 43.362247 → 43.360993).
- Bus 435: cambió en las tres lecturas.
- Bus 420: idéntico en las tres (probablemente parado en cabecera).

Conclusión: las posiciones se refrescan al menos cada ~15-20 s. **Límite de la medición:** con tan pocas muestras no se puede afirmar la cadencia exacta del GPS del bus (podría ser 10, 15 o 20 s) ni la latencia real. Intervalo de sondeo razonable para el adaptador: 15 s (como la web), a decidir tras el permiso (M1.5).

## Campos disponibles frente a `Entity` (`packages/schema`)

| Entity                  | Disponible | Origen / nota                                                                                                                                        |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | Sí         | `bus` (número de flota, p. ej. 420). Estable por vehículo; confirmar que no se reutiliza entre líneas                                                |
| `layer`                 | Sí         | constante `"bus"`                                                                                                                                    |
| `lon`, `lat`            | Sí         | `posx`, `posy`                                                                                                                                       |
| `ts`                    | **No**     | No hay hora de posición. Hay que usar la hora de recepción (epoch ms UTC) o convertir `fecha_peticion` (local → UTC); es hora de petición, no de GPS |
| `heading`               | **No**     | Calculable por diferencia entre lecturas consecutivas (estimado)                                                                                     |
| `speed`                 | **No**     | Calculable igual (estimado, ruidoso a 15 s)                                                                                                          |
| `meta.line`             | Sí         | Implícito en la petición (hay que mapear id interno → `lin_comer`)                                                                                   |
| `meta.direction`        | Sí         | `sentido` `"0"`/`"1"` (ida/vuelta), en `meta` como string o número                                                                                   |
| trip / siguiente parada | No         | No en esta función; habría que cruzar con GTFS (M1.1)                                                                                                |

No requiere cambios en `packages/schema` (`meta` admite `line` y `direction`). Aviso: `heading` y `speed` derivados deberían marcarse como estimados en `meta`.

## Licencia / términos de uso

**Decidida por el humano (2026-11-18): aceptada, uso con atribución a la fuente.** No se ha localizado licencia ni términos de uso de la API; la web no ofrece una API pública. El permiso se gestiona en M1.5 (contacto por el humano). Atribución requerida: desconocida.

## Riesgos

- **Legal:** API no oficial y sin licencia; reutilizar los datos sin permiso puede incumplir términos de la Compañía de Tranvías (o de sus proveedores). Sin respuesta de M1.5, no publicar esta capa como dato en vivo.
- **Estabilidad:** el esquema (`func`, `Web_Beta`, ids internos) puede cambiar sin aviso; `Content-Type` incorrecto; respuestas vacías sin error para ids no válidos. El adaptador debe validar con zod y tolerar `mapas:[[]]`.
- **Bloqueo:** cubrir las 26 líneas implica ~26 peticiones por ciclo; a 15 s son ~100 peticiones/min desde un único origen, lo que se puede interpretar como abuso. Mitigar: sondear solo líneas con servicio y en horario, sondeo más lento (30-60 s), una sola instancia en servidor (el navegador nunca llama), `User-Agent` identificable y caché.
- **Calidad:** sin `ts` real, sin rumbo ni velocidad; el catálogo (`func=7`) puede cambiar con las altas/bajas de paradas.
- **Privacidad:** son vehículos públicos, no hay datos personales.

## Plan B

Si no hay permiso o la API cae: **posiciones simuladas a partir del GTFS** (M1.1, `docs/sources/gtfs-tranvias.md`): interpolar cada viaje activo sobre su `shapes`/`stop_times` según la hora. Etiquetarlas siempre como «según horario» (no en tiempo real) en la UI y en `meta` (p. ej. `meta.source = "gtfs-sim"`), y degradar la sonificación/índice Pulso en consecuencia. Es el comportamiento por defecto si iTranvías no está disponible.

## Cómo se midió

10 peticiones GET en total, sin automatizar bucles, espaciadas ≥5 s, `User-Agent` genérico de verificación, sin cuenta ni cookies:

1. `https://itranvias.com/` (HTML).
2. 4 ficheros JS estáticos de la web (`functions.js`, `MapaItranvias_obj.js`, `main.js`, `Lineas_obj.js`) para localizar el endpoint.
3. `func=99&dato=1&mostrar=B` (id comercial; vacío).
4. `func=7` (catálogo, una vez).
5. 3 × `func=99&dato=100&mostrar=B` (≈20 s y ≈15 s de separación).

No se guardaron fixtures en el repo (se hará en M3.1 con el adaptador, si procede tras M1.5).
