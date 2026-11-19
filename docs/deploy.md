# Despliegue en un VPS

Producción mínima: `docker compose` con TimescaleDB, la ingesta, un backup diario y Caddy (HTTPS automático) sirviendo la web y las teselas. Todo está en `infra/deploy/`. Spec: `docs/specs/M3.6-despliegue-minimo.md`.

## Qué decide el humano (el agente no lo hace)

- Contratar el VPS y elegir proveedor.
- Comprar o elegir el dominio y crear el registro DNS.
- Generar y guardar las claves (`POSTGRES_PASSWORD`, `AISSTREAM_API_KEY`, `OPENSKY_*`…).
- Activar iTranvías (`ITRANVIAS_ENABLED=true`) solo cuando el permiso (M1.5) esté confirmado.
- Si se quiere copia de seguridad fuera del VPS y dónde.

## Requisitos del VPS

- ≤ 10 €/mes, Linux x86-64 o arm64 (Debian/Ubuntu), **2 GB de RAM**, 2 vCPU, 40 GB de disco (≈ 0,5 M filas/día; la compresión y la retención de 30 días mantienen la BD en pocos GB).
- IPv4 pública y puertos 80/tcp, 443/tcp y 443/udp abiertos. El 5432 **no** se publica nunca.
- Docker Engine con el plugin Compose v2 (`docker compose version`) y `git`.

## Paso a paso

1. **DNS**: crea un registro `A` (y `AAAA` si hay IPv6) de tu dominio hacia la IP del VPS. Caddy no podrá emitir el certificado hasta que resuelva.
2. **Código**: `git clone <repo> pulso && cd pulso` (rama `main`).
3. **Configuración**: `cp infra/deploy/.env.example infra/deploy/.env` y edita:
   - `DOMAIN=tu.dominio.es`
   - `POSTGRES_PASSWORD=$(openssl rand -hex 24)` (solo letras y dígitos: va dentro de una URL).
   - Opcional: `BACKUP_DIR` (carpeta absoluta del host), `BACKUP_HOUR_UTC`, `BACKUP_KEEP_DAYS`, claves de fuentes.
   - `.env` está ignorado por git; no lo subas nunca.
4. **Teselas**: genera `coruna.pmtiles` (`infra/tiles/README.md`) y cópialo al VPS en `infra/deploy/tiles/coruna.pmtiles` (o la carpeta de `TILES_DIR`), p. ej. `scp infra/tiles/.work/coruna.pmtiles vps:pulso/infra/deploy/tiles/`. Se sirve en `https://DOMINIO/tiles/coruna.pmtiles`.
5. **Arranque**: `docker compose -f infra/deploy/docker-compose.yml up -d --build` (la primera vez tarda unos minutos: compila la web y la ingesta).
6. **Comprobación**: `docker compose -f infra/deploy/docker-compose.yml ps` (todo `Up`, `db` `healthy`), `https://DOMINIO` carga y `infra/deploy/scripts/health.sh` (ver abajo).

Para no escribir `-f` cada vez: `export COMPOSE_FILE=infra/deploy/docker-compose.yml`.

## Ver que graba (demo)

```bash
infra/deploy/scripts/health.sh            # una vez
infra/deploy/scripts/health.sh --watch    # en vivo, cada 5 s
```

Muestra `source_health` (estado `ok`/`degraded`/`down`, fallos consecutivos, latencia, filas escritas, último error) y el número de filas y la última marca de `positions`, `station_status` y `observations`. Consulta directa:

```bash
docker compose exec db psql -U pulso -d pulso -c "SELECT * FROM source_health"
```

Con `registry.ts` sin adaptadores la ingesta arranca y migra pero no graba nada (`sources: []` en el log). «Primer día grabado» = dejarla 24 h con los adaptadores cableados y revisar `health.sh` (las filas deben crecer y `rows_written_total` subir en cada fuente).

Logs: `docker compose logs -f ingest` (JSON, rotados a 3×10 MB).

## Actualizar

```bash
git pull
docker compose -f infra/deploy/docker-compose.yml up -d --build
```

Solo se recrean los servicios cuyo código cambió. Las migraciones de la BD se aplican solas al arrancar la ingesta. Subir de versión de TimescaleDB: cambia la etiqueta en `docker-compose.yml` y en los ADR-0016, y haz backup antes.

## Backup y restauración

- El servicio `backup` hace cada día a `BACKUP_HOUR_UTC` (03:30 por defecto) un `pg_dump` comprimido en `BACKUP_DIR` (`pulso-AAAAMMDDTHHMMSSZ.dump`), verifica que se puede leer y borra los de más de `BACKUP_KEEP_DAYS` (14) días. Si falla, lo escribe en `docker compose logs backup` y reintenta al día siguiente.
- Backup manual: `docker compose exec backup sh /scripts/backup.sh`.
- **Restaurar** (reemplaza la BD `pulso`; para la ingesta mientras tanto):

  ```bash
  infra/deploy/scripts/restore.sh /ruta/pulso-20261118T033000Z.dump
  ```

  Pide confirmación (`--yes` para omitirla). Para comprobar un backup sin tocar la BD real: `restore.sh --db verif fichero.dump` y luego `docker compose exec db psql -U pulso -d verif`; bórrala con `DROP DATABASE verif`.

- Prueba la restauración de vez en cuando; un backup sin restaurar nunca es una garantía.
- **Los backups están en el mismo VPS**: no protegen si se pierde la máquina. Copia `BACKUP_DIR` fuera (p. ej. `rsync`/`rclone` desde tu portátil o un cron a un almacenamiento externo); dónde, lo decide el humano.
- El volumen `pgdata` (datos) y `caddy_data` (certificados) son volúmenes con nombre de Docker: no ejecutes `docker compose down -v` en producción.

## Probar en local (sin dominio)

```bash
cp infra/deploy/.env.example infra/deploy/.env   # DOMAIN=localhost; pon POSTGRES_PASSWORD=algo
mkdir -p infra/deploy/tiles                       # opcional: coruna.pmtiles
docker compose -f infra/deploy/docker-compose.yml up -d --build
curl -k https://localhost/                        # -k: la CA interna de Caddy no es de confianza
infra/deploy/scripts/health.sh
docker compose -f infra/deploy/docker-compose.yml down -v   # borra también los datos
```

Si 80/443 están ocupados en tu máquina, cambia `HTTP_PORT`/`HTTPS_PORT` (y pide `https://localhost:PUERTO`).

## API (M4.1)

El servicio `api` (`Dockerfile.api`, imagen sin `node_modules`, usuario `node`) arranca con el resto y lee de la BD lo que graba la ingesta. No publica puertos: Caddy lo expone en `/api/*` (incluido el WebSocket) en el mismo dominio que la web, así que no hace falta CORS. Spec: `docs/specs/M4.1-api-snapshot-stream.md`.

| Endpoint                                   | Qué da                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `GET /api/v1/snapshot?layers=bike,weather` | Último estado de las capas pedidas (todas si se omite). Capa desconocida → 400. Sin datos → `[]` |
| `WS /api/v1/stream[?layers=…]`             | Snapshot al conectar y luego deltas cada ≤ 2 s. 429 si la IP supera su límite                    |
| `GET /api/v1/health`                       | BD, estado de cada fuente (ok/degraded/down, edad) y última lectura por capa. 503 si la BD cae   |

```bash
curl -k https://localhost/api/v1/health
curl -k "https://localhost/api/v1/snapshot?layers=bike"
docker compose -f infra/deploy/docker-compose.yml logs -f api
```

Variables opcionales (en `infra/deploy/.env`; valores por defecto en `apps/api/src/config.ts`): `API_WS_MAX_PER_IP` (10), `API_POLL_MS` (2000), `API_WS_PING_MS` (30000), `API_CORS_ORIGINS` (`*`), `API_MAX_AGE_*_MS` (cuánto tiempo sigue «viva» una lectura: 5 min móviles, 1 h bicis, 6 h observaciones), `API_HEALTH_STALE_FACTOR` (3). `API_TRUST_PROXY=true` ya lo fija compose: la API toma la IP real de `X-Forwarded-For` que pone Caddy; **no** lo actives si la API queda expuesta sin proxy.

Con iTranvías apagada la capa `bus` sale vacía (`[]`) y `health.layers.bus.lastDataAt` es `null`: es lo esperado, no un fallo.

### Probar la API sin el stack completo

Para no arrancar la ingesta (que llama a fuentes reales) basta la BD y la imagen de la API:

```bash
docker build -f infra/deploy/Dockerfile.api -t pulso-api .
docker network create pt && docker run -d --rm --name pt-db --network pt -e POSTGRES_USER=pulso -e POSTGRES_PASSWORD=pulso -e POSTGRES_DB=pulso timescale/timescaledb:2.32.0-pg17
for f in apps/ingest/migrations/*.sql; do docker exec -i pt-db psql -q -U pulso -d pulso < $f; done
docker run -d --rm --name pt-api --network pt -p 3000:3000 -e DATABASE_URL=postgres://pulso:pulso@pt-db:5432/pulso pulso-api
curl localhost:3000/api/v1/health
# limpieza: docker rm -f pt-api pt-db; docker network rm pt
```

## Solución de problemas

- Caddy no obtiene certificado: el DNS aún no apunta al VPS o los puertos 80/443 están cerrados (`docker compose logs caddy`).
- `ingest` reinicia en bucle: mira `docker compose logs ingest`; suele ser `POSTGRES_PASSWORD` distinto del usado al crear el volumen (cambiarla en `.env` no cambia la de una BD ya creada).
- Disco lleno: revisa `BACKUP_KEEP_DAYS` y `docker system df`.
