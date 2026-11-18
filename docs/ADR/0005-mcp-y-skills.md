# ADR 0005 — MCP y skills de agentes

- Estado: aceptada (M0.1)
- Decisión: quitar el MCP de GitHub y usar `gh` CLI (ya autenticado); fijar versiones de los MCP locales (`chrome-devtools-mcp@1.13.0`, `@playwright/mcp@0.0.85`); Context7 sin clave obligatoria; nuevas skills `design-review` y `perf-budget`.
- Por qué: el MCP de GitHub fallaba sin PAT y duplicaba `gh`; `@latest` hace que el entorno cambie sin aviso; diseño y rendimiento necesitan una forma repetible de revisarse.
- Consecuencias: un secreto menos (`GITHUB_PAT`). Subir versiones de MCP es un cambio explícito en `.mcp.json` y `opencode.json`.
