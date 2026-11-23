export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Recorte centrado de un origen `sw×sh` con la proporción de `dw×dh` («cover»: sin bandas ni deformar). */
export function coverRect(sw: number, sh: number, dw: number, dh: number): Rect {
  const target = dw / dh;
  if (sw / sh > target) {
    const w = sh * target;
    return { x: (sw - w) / 2, y: 0, w, h: sh };
  }
  const h = sw / target;
  return { x: 0, y: (sh - h) / 2, w: sw, h };
}
