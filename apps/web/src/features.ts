/**
 * Flags de funciones (v1 simple). Por defecto todo apagado: la web muestra mapa, capas, tarjetas,
 * créditos/estado, idiomas y PWA. Se activan en build con `VITE_FEATURES=listen,replay,pulse,clip,share`
 * (lista separada por comas; `all` activa todas). Ver `docs/specs/V1-simple.md`.
 */
export type Feature = "listen" | "replay" | "pulse" | "clip" | "share";

export type Features = Readonly<Record<Feature, boolean>>;

const ALL: readonly Feature[] = ["listen", "replay", "pulse", "clip", "share"];

/** Interpreta la lista de flags; ignora espacios, mayúsculas y nombres desconocidos. */
export function parseFeatures(raw: string | undefined | null): Features {
  const on = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const name = part.trim().toLowerCase();
    if (name === "all") for (const f of ALL) on.add(f);
    else if (name) on.add(name);
  }
  const has = (f: Feature): boolean => on.has(f);
  return {
    listen: has("listen"),
    replay: has("replay"),
    pulse: has("pulse"),
    // El clip pone el valor del índice en su cuadro: sin Pulso no tiene sentido.
    clip: has("clip") && has("pulse"),
    share: has("share"),
  };
}

export const features: Features = parseFeatures(
  import.meta.env.VITE_FEATURES as string | undefined,
);
