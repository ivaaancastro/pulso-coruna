# Herramientas de desarrollo

## Configuradas en el repo

| Qué                                               | Dónde                                                  | Notas                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| MCP Context7, Chrome DevTools, Playwright, GitHub | `.mcp.json` (Claude Code) y `opencode.json` (opencode) | Las claves salen de variables de entorno, no del repo                                                                 |
| Hooks                                             | `.claude/settings.json`, `.claude/hooks/`              | Bloquea escribir `.env`; pide confirmación al tocar `packages/schema`; typecheck tras editar `.ts` (solo Claude Code) |
| Skills                                            | `.claude/skills/`                                      | `new-adapter`, `source-note`, `contract-change` (opencode también lee esta carpeta)                                   |
| Subagente                                         | `.claude/agents/reviewer.md`                           | Revisión de solo lectura                                                                                              |

## Puesta en marcha (una vez)

1. Node 20.19+ (o 22.12+) y pnpm instalados; Chrome estable.
2. Context7: clave gratuita en https://context7.com/dashboard → `export CONTEXT7_API_KEY=...`
3. GitHub: PAT fine-grained (https://github.com/settings/personal-access-tokens/new) solo sobre el repo `pulso-coruna`, con permisos de Contents, Pull requests, Issues y Actions en lectura/escritura según necesites → `export GITHUB_PAT=...`
4. Para no repetir los `export`, ponlos en `~/.zshrc` (nunca en el repo).
5. En el repo: `claude`, aprueba los MCP del proyecto cuando pregunte y comprueba con `/mcp`. En opencode: `opencode mcp list`.

## Skills de terceros (opcionales, revísalas antes de instalar)

- MapLibre: `npx skills add maplibre/maplibre-agent-skills --skill maplibre-pmtiles-patterns` (y `maplibre-tile-sources`).
- deck.gl: skill comunitaria `znlgis/deck-gl` (no oficial).

## Cuando exista la BD (T1.7)

Crear un rol Postgres con solo `SELECT` y añadir un MCP de Postgres apuntando a ese rol. No se configura aún.
Opcional para depurar WebGL: MCP de Spector.js (no verificado).

## Pendiente de decidir

Fijar versiones en un ADR antes de T1.9: MapLibre GL JS (hay v5 y v6) y deck.gl 9.x.
