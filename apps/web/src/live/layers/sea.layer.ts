import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { createTranslator, detectLocale, type Locale } from "../../i18n";
import { createNow } from "../../time/now";
import type { LiveLayerContext, LiveLayerDefinition } from "../layer-registry";
import {
  FOCUS_RGB,
  HIT_RADIUS_PX,
  LEVEL_TRANSITION_MS,
  SEA_RGB,
  haloDiscs,
  haloRadius,
  lineAlpha,
} from "../sea/halo";
import { TideHistory, readTide } from "../sea/history";
import { seaView, type SeaView } from "../sea/model";
import { createSeaUi, type SeaUi } from "../sea/sea-ui";
import { SEA_HALO_ANCHOR } from "../sea/station";

/**
 * Marea (M5.2a): una lámina de agua luminosa en el puerto cuya extensión y luz respiran con el
 * nivel del mar respecto al rango reciente, un indicador sobrio y una tarjeta. Sin lectura válida
 * no dibuja nada. No es animada: el nivel cambia con una transición lenta, sin coste por fotograma.
 * Diseño y decisiones: docs/specs/M5.2a-capa-marea.md.
 */
export interface SeaLayerOptions {
  /** Idioma (por defecto `?lang=` y el del navegador). */
  locale?: Locale;
  /** Reloj de la app para la tendencia y el «hace X» (por defecto `time/now.ts`). */
  now?: () => number;
  /** Dónde se monta el indicador (por defecto `.shell__top`). */
  chipParent?: () => HTMLElement;
}

export function createSeaLayer(opts: SeaLayerOptions = {}): LiveLayerDefinition {
  const history = new TideHistory();
  let ui: SeaUi | null = null;
  let latest: LiveLayerContext | null = null;
  /** Hay una lectura en el almacén y la fuente no está en `nodata`. */
  let hasData = false;
  let suppressed = false;

  const appNow = (): number => (opts.now ?? createNow(window.location.search))();

  const read = (): SeaView | null =>
    hasData && !suppressed ? seaView(history.samples, appNow()) : null;

  function ensureUi(): SeaUi {
    if (ui) return ui;
    const search = window.location.search;
    const locale = opts.locale ?? detectLocale(search, navigator.languages);
    ui = createSeaUi({
      chipParent:
        opts.chipParent?.() ?? document.querySelector<HTMLElement>(".shell__top") ?? document.body,
      // El panel común vive siempre en `#app` (un solo panel a la vez).
      cardParent: document.getElementById("app") ?? document.body,
      t: createTranslator(locale),
      locale,
      now: appNow,
      read,
      onOpenChange: () => latest?.invalidate(),
    });
    return ui;
  }

  function onPick(info: PickingInfo<unknown>): boolean {
    if (!info.object) return false;
    const card = ensureUi();
    card.setOpen(!card.open);
    return true;
  }

  return {
    id: "sea",
    sources: ["sea"],
    onSourceState(state) {
      // Sin dato (M4.6): ni indicador ni tarjeta con datos fantasma; el pipeline ya atenúa el halo.
      suppressed = state === "nodata";
      ui?.update();
    },
    createLayers(ctx): Layer[] {
      latest = ctx;
      const sample = readTide(ctx.store.items("sea").values());
      if (sample) history.record(sample);
      hasData = sample !== undefined;
      if (!sample) {
        ui?.update();
        return [];
      }
      const view = seaView(history.samples, appNow());
      if (!view) return [];
      const card = ensureUi();
      card.update();

      const position = [...SEA_HALO_ANCHOR] as [number, number];
      const discs = haloDiscs(view.fraction);
      const [r, g, b] = SEA_RGB;
      const transition = ctx.reducedMotion
        ? undefined
        : { duration: LEVEL_TRANSITION_MS, easing: (t: number) => 1 - (1 - t) ** 3 };
      const meters = { radiusUnits: "meters", billboard: false } as const;
      const pixels = { radiusUnits: "pixels", lineWidthUnits: "pixels", billboard: true } as const;

      return [
        // Lámina: discos concéntricos que se suman hacia el centro (un halo suave sobre el agua).
        new ScatterplotLayer<(typeof discs)[number]>({
          ...meters,
          id: "sea-halo",
          data: discs,
          getPosition: () => position,
          getRadius: (d) => d.radius,
          stroked: false,
          filled: true,
          getFillColor: (d) => [r, g, b, d.alpha],
          // Discos coplanares: sin prueba de profundidad se mezclan en orden en vez de parpadear.
          parameters: { depthCompare: "always", depthWriteEnabled: false },
          transitions: transition && { getRadius: transition, getFillColor: transition },
        }),
        // Línea de nivel: aro fino en el borde de la lámina.
        new ScatterplotLayer<{ radius: number }>({
          ...meters,
          id: "sea-line",
          data: [{ radius: haloRadius(view.fraction) }],
          getPosition: () => position,
          getRadius: (d) => d.radius,
          stroked: true,
          filled: false,
          lineWidthUnits: "pixels",
          getLineWidth: 1.5,
          getLineColor: [r, g, b, lineAlpha(view.fraction)],
          transitions: transition && { getRadius: transition, getLineColor: transition },
        }),
        // Mareógrafo: punto fijo; aro de foco si la tarjeta está abierta.
        new ScatterplotLayer({
          ...pixels,
          id: "sea-gauge",
          data: [{}],
          getPosition: () => position,
          getRadius: 4,
          stroked: ui?.open === true,
          filled: true,
          getFillColor: [r, g, b, 255],
          getLineWidth: 2,
          getLineColor: [...FOCUS_RGB, 255],
        }),
        // Zona de toque de 44 px, casi transparente (la vía por teclado es el indicador DOM).
        new ScatterplotLayer({
          ...pixels,
          id: "sea-hit",
          data: [{}],
          getPosition: () => position,
          getRadius: HIT_RADIUS_PX,
          stroked: false,
          filled: true,
          getFillColor: [0, 0, 0, 1],
          pickable: true,
          onClick: onPick,
        }),
      ];
    },
  };
}

const sea = createSeaLayer();
export default sea;
