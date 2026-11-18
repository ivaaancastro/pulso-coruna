## Resumen

<!-- Qué cambia y por qué, en 2-4 líneas. -->

## Spec (SDD)

- Tarea: <!-- T1.x de docs/TASKS.md -->
- Spec / sección: <!-- docs/specs/<id>.md o sección de docs/SPEC.md -->
- [ ] La implementación cumple los criterios de aceptación de la spec
- [ ] Si la spec cambió, está actualizada en esta misma PR

## Cambios

-

## Cómo probarlo

```bash
pnpm install && pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm format:check
```

## Riesgos

<!-- Contrato (`packages/schema`), dependencias, migraciones, rendimiento… o "ninguno". -->

## Checklist (definición de hecho)

- [ ] Tests, typecheck, lint y format en verde
- [ ] ADR añadido/actualizado si cambia una decisión técnica
- [ ] Sin secretos ni llamadas a APIs reales en tests
- [ ] Sin dependencias nuevas sin ADR
- [ ] Revisada por otra persona o agente (no auto-aprobada)
