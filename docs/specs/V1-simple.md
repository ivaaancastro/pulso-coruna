# V1 simple — funciones apagadas por flag

La v1 pública muestra solo lo esencial. El código de las demás funciones sigue en el repo y se
reactiva por configuración de build; nada se ha borrado.

## Qué queda

Mapa 3D, capas (buses, bici, viento, mar, barcos, aire, aviones), tarjetas, reloj, estado y
créditos, idiomas (es/gl/en), PWA, accesibilidad y la cámara en el hash de la URL (`#…`), que
funciona sin Reproducir ni botón de compartir.

## Qué se apaga

| Flag     | Función                                                                 |
| -------- | ----------------------------------------------------------------------- |
| `listen` | Escuchar (sonificación): botón y motor de audio.                        |
| `replay` | Reproducir: selector de modos, línea temporal y `mode=replay` del hash. |
| `pulse`  | Índice Pulso (0–100) y su serie de 24 h.                                |
| `clip`   | Clip vertical de 15 s. Exige también `pulse` (el clip lleva el índice). |
| `share`  | Botón de compartir. (La vista previa OG es del servidor y no depende.)  |

## Cómo reactivar

`VITE_FEATURES` en build (lista separada por comas, sin espacios obligatorios; `all` = todas):

```sh
VITE_FEATURES=listen,replay,pulse,clip,share pnpm --filter @pulso/web build
```

Por defecto (variable vacía o ausente) todas están apagadas. Nombres desconocidos se ignoran.
El parser está en `apps/web/src/features-parse.ts`; `vite.config.ts` lo lee y declara los flags
como constantes de compilación (`__FEATURE_*__`, tipadas en `src/feature-flags.d.ts`). En `main.ts`
se usan directamente (no a través de un módulo) para que el bundler elimine ramas e `import()`.
Cambiar un flag exige reconstruir.

## Comportamiento

- Con todo apagado el build ni siquiera emite los chunks de esas funciones (audio, replay, pulse,
  clip). No se monta el selector de modos si solo existe «Ahora»; con solo `listen` aparece
  únicamente el botón Escuchar.
- Sin `replay`, un enlace con `mode=replay` se abre en «Ahora» y solo se aplica su cámara.
- La API no cambia (los endpoints de pulso y clip siguen existiendo).
