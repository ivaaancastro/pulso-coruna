import type { Entity } from "@pulso/schema";

/**
 * Claves de `Entity.meta` que consume la capa de barcos (las produce el adaptador aisstream,
 * M5.1c). El `id` es un hash corto, no el MMSI: nunca se muestra.
 */
export const SHIP_META = {
  name: "name",
  shipType: "shipType",
  navStatus: "navStatus",
} as const;

/** Tipo de barco para la tarjeta (traducido) y el tamaño en el mapa. */
export type ShipKind =
  "cargo" | "tanker" | "passenger" | "fishing" | "tug" | "pleasure" | "service" | "other";

const MAX_NAME = 40;

/** AIS «Type of ship and cargo» (ITU-R M.1371) → categoría. Desconocido o sin tipo: `other`. */
export function shipKind(shipType: number | undefined): ShipKind {
  if (shipType === undefined) return "other";
  if (shipType >= 70 && shipType <= 79) return "cargo";
  if (shipType >= 80 && shipType <= 89) return "tanker";
  if ((shipType >= 60 && shipType <= 69) || (shipType >= 40 && shipType <= 49)) return "passenger";
  if (shipType === 30) return "fishing";
  if (shipType === 31 || shipType === 32 || shipType === 52) return "tug";
  if (shipType === 36 || shipType === 37) return "pleasure";
  if ((shipType >= 33 && shipType <= 35) || (shipType >= 50 && shipType <= 59)) return "service";
  return "other";
}

/** Solo la categoría (barato: sin nombre), para el estilo por fotograma. */
export function kindOf(entity: Entity): ShipKind {
  return shipKind(int(entity.meta?.[SHIP_META.shipType]));
}

export interface ShipInfo {
  kind: ShipKind;
  /** Nombre AIS saneado; `undefined` si no hay o si es una embarcación de recreo (privacidad). */
  name?: string;
  /** Velocidad sobre el fondo, m/s. */
  speed?: number;
  /** Rumbo, grados [0, 360). */
  heading?: number;
  navStatus?: number;
  /** Hora del dato (epoch ms UTC). */
  ts: number;
}

function int(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function cleanName(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  // Los nombres AIS llegan en mayúsculas, con relleno de «@» o espacios.
  const s = String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[@\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s === "" ? undefined : s.slice(0, MAX_NAME);
}

/**
 * Lee un barco. Privacidad (decisión humana): el nombre solo sale si el tipo AIS es conocido y no es
 * recreo (36 vela, 37 recreo); sin tipo o en recreo puede identificar a una persona y no sale del módulo.
 */
export function shipInfo(entity: Entity): ShipInfo {
  const meta = entity.meta ?? {};
  const type = int(meta[SHIP_META.shipType]);
  const kind = shipKind(type);
  return {
    kind,
    name: type === undefined || kind === "pleasure" ? undefined : cleanName(meta[SHIP_META.name]),
    speed: entity.speed,
    heading: entity.heading,
    navStatus: int(meta[SHIP_META.navStatus]),
    ts: entity.ts,
  };
}
