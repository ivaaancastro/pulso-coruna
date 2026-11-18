# REData (Red Eléctrica): solo contexto regional

- **Verificado:** 2026-11-18 (UTC). Documentación: <https://www.ree.es/es/datos/apidatos>. API: `https://apidatos.ree.es`.
- **Alcance:** **contexto regional/nacional, no municipal.** REData no ofrece datos de A Coruña ciudad; como mucho sirve para un indicador de fondo (generación renovable, emisiones, demanda del sistema). No alimenta capas del mapa.
- **Acceso:** `GET /{lang}/datos/{categoria}/{widget}?start_date=…&end_date=…&time_trunc=…[&geo_trunc=…&geo_limit=…&geo_ids=…]`, solo GET, cabecera `Accept: application/json`. Sin clave ni cuenta. Límites de uso no documentados en la página leída. Hay protección Incapsula (cookies `visid_incap_*`); no se guardaron cookies.
- **Licencia / términos:** no localizada en la página de la API (solo enlace genérico «Aviso legal», no leído). **Pendiente de decisión humana.**
- **Peticiones:**
  - Peninsular, `generacion/estructura-generacion?start_date=2026-11-01T00:00&end_date=2026-11-07T23:59&time_trunc=day`: **200**, 15 tecnologías, `last-update` 2026-11-18T07:56+01:00.
  - Intento por comunidad (`geo_trunc=electric_system&geo_limit=ccaa&geo_ids=11`, 11 supuesto Galicia, sin verificar), con ese rango y con un solo día: **500** las dos veces. **No se obtuvo desglose gallego**; la disponibilidad regional por widget queda por comprobar (el error puede ser de parámetros).
- **Frecuencia:** agregados diarios/mensuales actualizados a lo largo del día (`last-update` de hoy 07:56 +01:00 con datos hasta ayer); no es tiempo real.

## Muestra (recortada)

```json
{
  "data": {
    "type": "Generación por tecnología",
    "id": "gen1",
    "attributes": {
      "title": "Generación por tecnología",
      "last-update": "2026-11-18T07:56:28.000+01:00"
    }
  },
  "included": [
    {
      "type": "Hidráulica",
      "id": "10288",
      "groupId": "1",
      "attributes": {
        "title": "Hidráulica",
        "type": "Renovable",
        "values": [
          {
            "value": 39712.3,
            "percentage": 0.0585718940305688,
            "datetime": "2026-11-01T00:00:00.000+01:00"
          }
        ]
      }
    }
  ]
}
```

La unidad de `value` no aparece en la muestra (probablemente MWh; comprobar). Las fechas llevan offset `+01:00`: convertir a epoch ms UTC.

## Mapeo a `packages/schema`

No se mapea a `Entity`. Tampoco encaja en `Observation`: sus capas son `weather|air|sea` y no hay capa de energía. No se propone cambio de contrato; si se usa, será dato auxiliar fuera del esquema, o se deja fuera del alcance.

## Riesgos

- Cobertura no municipal: no presentarlo como dato de la ciudad.
- Errores 500 con ciertos parámetros; protección anti-bot.
- Licencia sin confirmar.
