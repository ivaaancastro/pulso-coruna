import type { Entity, LayerItem } from "@pulso/schema";

/**
 * Claves de `Entity.meta` que consume la capa de aviones (las produce el adaptador OpenSky, M5.1d)
 * y lectura de la `Entity`. `id` = icao24, `heading` = true_track (grados), `speed` en m/s,
 * `ts` = hora de la posición en la fuente (epoch ms UTC).
 */
export const PLANE_META = {
  callsign: "callsign",
  alt: "alt",
  onGround: "onGround",
  vrate: "vrate",
} as const;

export interface PlaneInfo {
  id: string;
  lon: number;
  lat: number;
  ts: number;
  /** Rumbo en grados [0, 360), 0 = norte. */
  heading?: number;
  /** Velocidad sobre el suelo, m/s. */
  speed?: number;
  callsign?: string;
  /** Altitud, m. */
  altM?: number;
  onGround: boolean;
  /** Velocidad vertical, m/s (+ asciende). */
  vrate?: number;
}

function num(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function isPlane(item: LayerItem | undefined): item is Entity {
  return item !== undefined && "layer" in item && item.layer === "plane";
}

export function planeInfo(entity: Entity): PlaneInfo {
  const meta = entity.meta ?? {};
  const rawCallsign = meta[PLANE_META.callsign];
  const callsign = rawCallsign === undefined ? "" : String(rawCallsign).trim();
  const heading = entity.heading;
  const speed = entity.speed;
  return {
    id: entity.id,
    lon: entity.lon,
    lat: entity.lat,
    ts: entity.ts,
    heading:
      heading !== undefined && Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : undefined,
    speed: speed !== undefined && Number.isFinite(speed) ? speed : undefined,
    callsign: callsign === "" ? undefined : callsign,
    altM: num(meta[PLANE_META.alt]),
    onGround: num(meta[PLANE_META.onGround]) === 1,
    vrate: num(meta[PLANE_META.vrate]),
  };
}
