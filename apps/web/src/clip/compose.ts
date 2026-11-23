import { INTL_LOCALE } from "../i18n";
import { formatMadridTime } from "../time/format";
import { coverRect } from "./geometry";
import { CLIP_FPS, CLIP_HEIGHT, CLIP_WIDTH, type ClipContext } from "./types";

const canvas2d = (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
  const canvas = document.createElement("canvas");
  canvas.width = CLIP_WIDTH;
  canvas.height = CLIP_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("recorder");
  return { canvas, ctx };
};

/** Copia `src` recortado a 9:16 «cover» sobre `ctx`. Un lienzo WebGL solo es legible justo tras dibujar. */
function copyCover(src: HTMLCanvasElement, ctx: CanvasRenderingContext2D): boolean {
  if (src.width === 0 || src.height === 0) return false;
  const r = coverRect(src.width, src.height, CLIP_WIDTH, CLIP_HEIGHT);
  ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, CLIP_WIDTH, CLIP_HEIGHT);
  return true;
}

const FONT = '"Archivo", system-ui, sans-serif';

/** Marca, hora, índice Pulso y créditos sobre el mapa. Todo texto sale de i18n (gl/es/en). */
export function drawOverlay(ctx: CanvasRenderingContext2D, c: ClipContext): void {
  const w = CLIP_WIDTH;
  const h = CLIP_HEIGHT;
  const pad = 72;
  const room = w - 2 * pad;
  const scrim = (y0: number, y1: number, a0: number, a1: number): void => {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, `rgba(5,8,14,${a0})`);
    g.addColorStop(1, `rgba(5,8,14,${a1})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.min(y0, y1), w, Math.abs(y1 - y0));
  };
  scrim(0, 640, 0.88, 0);
  scrim(h - 760, h, 0, 0.92);

  // `maxWidth` de fillText comprime el texto largo (otros idiomas) en vez de salirse del lienzo.
  const text = (s: string, x: number, y: number, weight: number, size: number, color: string) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(s, x, y, room);
  };
  const { value, fixed } = c.index();
  text(c.t("app.name"), pad, 250, 500, 44, "#8e9bb0");
  text(formatMadridTime(c.now(), INTL_LOCALE[c.locale]), pad, 420, 300, 168, "#e8eef7");
  text(c.t("pulse.label"), pad, 1400, 500, 44, "#8e9bb0");
  const shown = value === null ? "–" : String(Math.round(value));
  text(shown, pad, 1630, 300, 240, value === null ? "#7a88a4" : "#e8eef7");
  text(c.t("pulse.scale"), pad + ctx.measureText(shown).width + 24, 1630, 400, 48, "#8e9bb0");
  if (value !== null && fixed) text(c.t("pulse.profile.fixed"), pad, 1692, 400, 36, "#8e9bb0");
  text(c.t("clip.credit"), pad, 1800, 400, 28, "#7a88a4");
}

export interface Composer {
  /** Lienzo 1080×1920 del que sale `captureStream`. */
  canvas: HTMLCanvasElement;
  /** Resuelve cuando hay una instantánea del mapa (y de deck.gl si existe); como mucho tras `ms`. */
  ready(ms?: number): Promise<void>;
  destroy(): void;
}

/**
 * Compone mapa + deck.gl + overlay en un lienzo 9:16 sin `preserveDrawingBuffer`: copia cada lienzo WebGL
 * en el evento de render (MapLibre `render`, deck.gl `onAfterRender`), cuando el búfer aún es legible, y un
 * temporizador de ~30 fps compone las dos copias. Solo cuesta mientras hay un compositor vivo.
 */
export function startComposer(c: ClipContext): Composer {
  const out = canvas2d();
  const mapLayer = canvas2d();
  const deckLayer = canvas2d();
  let gotMap = false;
  let gotDeck = c.deck === null;
  let waiting: (() => void) | null = null;
  const check = (): void => {
    if (gotMap && gotDeck) waiting?.();
  };

  const onMap = (): void => {
    if (copyCover(c.map.getCanvas(), mapLayer.ctx)) {
      gotMap = true;
      check();
    }
  };
  const onDeck = (): void => {
    const src = c.deck?.canvas();
    if (!src) return;
    deckLayer.ctx.clearRect(0, 0, CLIP_WIDTH, CLIP_HEIGHT);
    if (copyCover(src, deckLayer.ctx)) {
      gotDeck = true;
      check();
    }
  };
  c.map.on("render", onMap);
  const offDeck = c.deck?.onFrame(onDeck);
  c.map.triggerRepaint(); // MapLibre → `deck.redraw()` en cada `render`: ambas copias llegan enseguida

  const paint = (): void => {
    out.ctx.drawImage(mapLayer.canvas, 0, 0);
    if (c.deck) out.ctx.drawImage(deckLayer.canvas, 0, 0);
    drawOverlay(out.ctx, c);
  };
  out.ctx.fillStyle = "#05080e";
  out.ctx.fillRect(0, 0, CLIP_WIDTH, CLIP_HEIGHT);
  const timer = setInterval(paint, 1000 / CLIP_FPS);

  return {
    canvas: out.canvas,
    ready: (ms = 1_000) =>
      new Promise<void>((resolve) => {
        const done = (): void => {
          waiting = null;
          paint();
          resolve();
        };
        if (gotMap && gotDeck) return done();
        waiting = done;
        setTimeout(done, ms);
      }),
    destroy() {
      clearInterval(timer);
      c.map.off("render", onMap);
      offDeck?.();
    },
  };
}
