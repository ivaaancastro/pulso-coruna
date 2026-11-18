# Flujo de trabajo

## Ramas

| Rama                                                             | Origen    | Destino   | Notas                                              |
| ---------------------------------------------------------------- | --------- | --------- | -------------------------------------------------- |
| `main`                                                           | —         | —         | Protegida. Solo recibe PR de `develop` (releases). |
| `develop`                                                        | `main`    | `main`    | Protegida. Solo recibe PR de ramas de trabajo.     |
| `feat/*` `fix/*` `docs/*` `chore/*` `refactor/*` `test/*` `ci/*` | `develop` | `develop` | Una tarea = una rama = una PR.                     |

Nadie hace commit ni push directo a `main` ni `develop`: todo entra por PR con CI verde y 1 revisión aprobada, historial lineal (squash merge).

Nombre de rama: `<tipo>/<ID>-<slug>` (ej. `feat/M0.2-schema-zod`). Commits convencionales.

## Spec-Driven Development (SDD)

1. **Spec**: crear/actualizar `docs/specs/<ID>-<slug>.md` (plantilla `_template.md`) con objetivo, alcance y criterios de aceptación comprobables.
2. **Plan**: plan breve y aprobado antes de tocar código.
3. **Implementación** guiada por la spec: tests primero o junto al código, que verifican los criterios.
4. **PR** a `develop` usando la plantilla; enlaza la spec y marca los criterios.
5. **Revisión cruzada** (`docs/prompts/review-template.md`); si la implementación se desvía, se corrige la spec en la misma PR.
6. **Release**: PR `develop` → `main` (merge commit, sin squash, para no divergir).

## Comandos

```bash
git switch develop && git pull
git switch -c feat/M0.2-schema-zod
# ... trabajo ...
pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm format:check
git push -u origin feat/M0.2-schema-zod
gh pr create --base develop
```

## Protecciones (GitHub)

Configuradas con ruleset/branch protection en `main` y `develop`: PR obligatoria, check `check` en verde, 1 aprobación, conversaciones resueltas, sin force-push ni borrado, aplicadas también a administradores.
Tras el merge, las ramas de trabajo se borran automáticamente.
