---
name: design-review
description: Revisión visual de una pantalla o PR de UI contra la dirección de arte (docs/design/). Úsalo en cualquier tarea que cambie lo que se ve (M2 en adelante) antes de abrir la PR.
---
# Revisión de diseño

1. Lee `docs/design/README.md` y `docs/design/tokens.md` (si aún no existe, revisa solo contra los principios).
2. Arranca la web en local y abre la pantalla con el MCP de Playwright (el mapa es canvas: usa capturas, no el árbol de accesibilidad).
3. Captura en 390×844 y 1440×900; de noche y de día (fuerza la hora si hay parámetro); con `prefers-reduced-motion: reduce`. Captura también la intro a 0 s, 1 s y al terminar.
4. Comprueba: jerarquía (el dato brilla, el mapa base no compite), colores y tipografía de los tokens, cifras tabulares, etiquetas ≥ 12 px, contraste AA en UI, foco de teclado visible, estados vacío/fuente caída/cargando diseñados, nada de texto no interactivo sobre el mapa.
5. Movimiento: duraciones y curvas de los tokens, sin saltos al llegar datos, intro interrumpible.
6. Entrega una lista priorizada (bloqueante / importante / menor) con la captura de cada defecto. No decidas la paleta ni la tipografía final: si algo no está en `docs/design/`, márcalo como «pendiente de decisión humana».
