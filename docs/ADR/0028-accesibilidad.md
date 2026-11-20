# ADR-0028: accesibilidad — tokens sin cambios y comprobaciones automáticas

- Fecha: 2026-11-20
- Estado: aceptada

## Contexto

M8.2 pide contraste AA, paleta apta para daltonismo y reduced-motion. Sin dependencias nuevas.

## Decisión

No se tocan los colores de `tokens.css`: todos los pares de texto cumplen ≥ 4,5 y los de UI/capas ≥ 3, y bajo protanopía/deuteranopía/tritanopía las capas quedan a ΔE76 ≥ 10 salvo `sea/train` en deuteranopía (6,3; el tren no se dibuja y, si llega, tiene forma propia). Se fijan con tests que leen `tokens.css` (matemática en `styles/color-math.ts`, solo tests) y con un test que exige versión reducida para cada `transition`/`animation` del CSS. La acromatopsia se cubre con forma redundante por capa, no con color. El lienzo de deck.gl se oculta a la tecnología de apoyo; la selección de objetos por teclado queda como propuesta (M8.x).

## Consecuencias

Un cambio de token que rompa contraste o distinguibilidad falla en CI. Los ΔE son de simulación, no de personas: falta una comprobación humana antes del lanzamiento.
