/** Contenedores que deck.gl crea dentro del mapa; se prueban varios por si cambia la clase interna. */
const DECK_CANVAS = ".deck-widget-container canvas, .deck-canvas, [class*='deck-'] canvas";

/**
 * El canvas de deck.gl es decorativo para la accesibilidad (los objetos solo se eligen con puntero):
 * sin nombre ni rol y con `tabindex=0` sería una parada de teclado vacía. Devuelve cuántos ocultó.
 */
export function hideDeckCanvas(container: ParentNode): number {
  const canvases = container.querySelectorAll<HTMLCanvasElement>(DECK_CANVAS);
  for (const canvas of canvases) {
    canvas.tabIndex = -1;
    canvas.setAttribute("aria-hidden", "true");
  }
  return canvases.length;
}

/**
 * Oculta el canvas ahora y cada vez que deck.gl añada o recree uno (observador acotado al
 * contenedor del mapa, solo altas de nodos). Devuelve la función que lo desconecta.
 */
export function watchDeckCanvas(container: HTMLElement): () => void {
  hideDeckCanvas(container);
  if (typeof MutationObserver === "undefined") return () => undefined;
  const observer = new MutationObserver((records) => {
    if (records.some((r) => r.addedNodes.length > 0)) hideDeckCanvas(container);
  });
  observer.observe(container, { childList: true, subtree: true });
  return () => observer.disconnect();
}
