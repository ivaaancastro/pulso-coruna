# Calidade do Aire de Galicia (estaciones de A Coruña)

- **Verificado:** 2026-11-18 (UTC). **Resultado: no se localizó una vía de acceso abierta a los datos; no hay muestra.**
- **Web:** <https://www.meteogalicia.gal/web/calidade-do-aire/inicio> (200). SPA Angular que sin JavaScript solo muestra el título «MeteoGalicia». Sus peticiones de datos llevan una cabecera `apikey` (clave de API-manager incrustada en la web) y un token de sesión opcional. **No se extrajo ni se usó esa clave**: no se entregó al proyecto y su uso no está autorizado (pendiente de decisión humana).
- **Catálogo Open Data Xunta:** <https://abertos.xunta.gal/catalogo> responde, pero la búsqueda es dinámica y no se pudo listar con peticiones simples un conjunto de calidad del aire. **No confirmado** que exista.
- **Servicios MeteoGalicia** `https://www.meteogalicia.gal/web/rss-georss-json` (RSS/GeoRSS/JSON): también SPA; sin contenido legible sobre aire sin JavaScript.
- **Licencia / términos:** no localizada. **Pendiente de decisión humana.** Contactar con MeteoGalicia/Xunta lo decide el humano.
- **Frecuencia:** no medida. Se espera horaria (habitual en redes de calidad del aire), **sin verificar**.
- **Estaciones de A Coruña:** no verificadas desde fuente. Pendiente listar (id, nombre, lat/lon, contaminantes).

## Contaminantes previstos

NO2, PM10, PM2.5, O3, SO2, CO (los que mida cada estación; a confirmar por estación).

## Mapeo a `packages/schema` (propuesto)

`Observation`: `layer: "air"`, `stationId: "<id estación>"`, `metric` en `no2 | pm10 | pm25 | o3 | so2 | co`, `unit: "µg/m³"` (CO suele ser mg/m³: convertir o declarar), `ts` en epoch ms UTC (convertir desde la hora local de la fuente, `Europe/Madrid`, con cuidado en los cambios horarios).
La ubicación de la estación iría en un catálogo de estaciones; revisar con `contract-change` si el contrato lo prevé.

## Riesgos

- Sin API abierta localizada; la web depende de una clave de API-manager interna.
- Licencia desconocida.
- Posible retraso (datos validados vs. provisionales) y huecos por mantenimiento.
- Alternativas a evaluar por el humano: portal Open Data de la Xunta, datos del Ministerio (MITECO) o de la Agencia Europea de Medio Ambiente, si cubren las estaciones de A Coruña.
