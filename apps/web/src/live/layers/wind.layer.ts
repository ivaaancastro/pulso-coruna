import { createWindLayer } from "../wind/wind-layer";

/**
 * Viento (M4.5): partículas con estela interpoladas entre las estaciones de MeteoGalicia.
 * M4.7 degrada con `windLayer.setQuality(0..1)` (se obtiene de `listLiveLayers()` por `id: "wind"`).
 * Diseño y decisiones: docs/specs/M4.5-viento.md.
 */
const windLayer = createWindLayer();
export default windLayer;
