# Herramientas de desarrollo

## Configuradas en el repo

| Qué                              | Dónde                                                                                                                                                  | Notas                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| MCP Context7                     | Claude Code: configuración global del usuario (no en `.mcp.json`, una entrada de proyecto con clave vacía pisaba la global); opencode: `opencode.json` | Docs de librerías al día. Funciona sin clave (con límite de uso); clave opcional                                      |
| MCP Chrome DevTools (`1.13.0`)   | ídem                                                                                                                                                   | Trazas de rendimiento, Lighthouse, fps, heap. Lo usa la skill `perf-budget`                                           |
| MCP Playwright (`0.0.85`)        | ídem                                                                                                                                                   | Capturas del mapa (canvas/WebGL: modo visión). Lo usa la skill `design-review`                                        |
| GitHub                           | `gh` CLI                                                                                                                                               | Sin MCP (ADR 0005). `gh auth status` para comprobar                                                                   |
| Hooks                            | `.claude/settings.json`, `.claude/hooks/`                                                                                                              | Bloquea escribir `.env`; pide confirmación al tocar `packages/schema`; typecheck tras editar `.ts` (solo Claude Code) |
| Skills del proyecto              | `.claude/skills/`                                                                                                                                      | `new-adapter`, `source-note`, `contract-change`, `design-review`, `perf-budget` (opencode también lee esta carpeta)   |
| Skill `frontend-design` (plugin) | Plugin de Claude Code (solo Claude Code, no opencode)                                                                                                  | Para proponer dirección visual y UI nueva sin caer en plantillas                                                      |
| Subagente                        | `.claude/agents/reviewer.md`                                                                                                                           | Revisión de solo lectura contra `develop`                                                                             |

Las versiones de los MCP están fijadas: subirlas es un cambio explícito en ambos archivos (`npm view <paquete> version`).

## Puesta en marcha (una vez)

1. Node 20.19+ (o 22.12+) y pnpm instalados; Chrome estable.
2. `gh auth login` (si no lo has hecho ya).
3. Opcional, Context7 con más cuota: clave gratuita en https://context7.com/dashboard → `export CONTEXT7_API_KEY=...` en `~/.zshrc` (nunca en el repo).
4. En el repo: `claude`, aprueba los MCP del proyecto y comprueba que conectan chrome-devtools y playwright, y que Context7 (global) responde. En opencode: `opencode mcp list`.

## Conectores de la cuenta que no se usan aquí

Vercel y Supabase pueden aparecer como conectores de claude.ai: no encajan con ADR 0001 (VPS + Timescale propio). No los uses para este proyecto salvo nuevo ADR.

## Skills de terceros (opcionales, revísalas antes de instalar — decisión humana)

- MapLibre: `npx skills add maplibre/maplibre-agent-skills --skill maplibre-pmtiles-patterns` (y `maplibre-tile-sources`). Útil en M2.1–M2.2.
- deck.gl: skill comunitaria `znlgis/deck-gl` (no oficial).

## Cuando exista la BD (M3.5)

Crear un rol Postgres con solo `SELECT` y añadir un MCP de Postgres apuntando a ese rol (con ADR).
Opcional para depurar WebGL: MCP de Spector.js (no verificado).

## Pendiente de decidir

Fijar versiones de MapLibre GL JS (v5 o v6) y deck.gl 9.x en un ADR (M1.7), antes de M2.2.
