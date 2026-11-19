import type { Entity } from "@pulso/schema";

/**
 * Nombres de las claves de `Entity.meta` que la capa bus consume (los produce el backend: iTranvías
 * reales o el estimador por horario, M4.3a). Es el único sitio donde se nombran: si el contrato
 * cambia de nombre, se ajusta aquí.
 */
export const BUS_META = {
  line: "line",
  headsign: "headsign",
  nextStop: "nextStop",
  /** Presente (valor 1) cuando la posición es una estimación por horario, no real. */
  estimated: "estimated",
} as const;

export interface BusInfo {
  id: string;
  line?: string;
  headsign?: string;
  nextStop?: string;
  /** `true`: posición estimada según horario. Sin la marca: posición real. */
  estimated: boolean;
}

function text(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const s = String(value).trim();
  return s === "" ? undefined : s;
}

function isEstimated(value: string | number | undefined): boolean {
  return value === 1 || value === "1" || value === "true";
}

/** Lee los metadatos de un bus; tolera su ausencia (bus sin línea, destino o próxima parada). */
export function busInfo(entity: Entity): BusInfo {
  const meta = entity.meta ?? {};
  return {
    id: entity.id,
    line: text(meta[BUS_META.line]),
    headsign: text(meta[BUS_META.headsign]),
    nextStop: text(meta[BUS_META.nextStop]),
    estimated: isEstimated(meta[BUS_META.estimated]),
  };
}
