import { ReplayWindowSchema, toReplayCoord, toReplaySpeed, type ReplayWindow } from "@pulso/schema";
import { WINDOW_MS } from "./windows";

/** Utilidades solo para tests (no se importan desde código de producción). */
export const W0 = 1_760_000_100_000 - (1_760_000_100_000 % WINDOW_MS); // alineado a 5 min

export interface TrackSpec {
  id: string;
  meta?: Record<string, string | number>;
  /** Estado inicial: ms antes de `from` y posición. */
  init?: { dt: number; lon: number; lat: number; heading?: number; speed?: number };
  /** Muestras: ms desde `from` y posición. */
  samples?: {
    ts: number;
    lon: number;
    lat: number;
    heading?: number | null;
    speed?: number | null;
  }[];
}

export function mobileWindow(
  from: number,
  layer: "bus" | "ship" | "plane",
  tracks: TrackSpec[],
  extra: Partial<ReplayWindow["layers"]> = {},
): ReplayWindow {
  const win = {
    v: 1,
    from,
    to: from + WINDOW_MS,
    resolution: "raw" as const,
    layers: {
      [layer]: {
        kind: "mobile" as const,
        tracks: tracks.map((t) => {
          const samples = t.samples ?? [];
          const anyHeading = samples.some((s) => s.heading !== undefined && s.heading !== null);
          const anySpeed = samples.some((s) => s.speed !== undefined && s.speed !== null);
          return {
            id: t.id,
            ...(t.meta ? { meta: t.meta } : {}),
            ...(t.init
              ? {
                  init: {
                    dt: t.init.dt,
                    lon: toReplayCoord(t.init.lon),
                    lat: toReplayCoord(t.init.lat),
                    ...(t.init.heading !== undefined ? { heading: t.init.heading } : {}),
                    ...(t.init.speed !== undefined ? { speed: toReplaySpeed(t.init.speed) } : {}),
                  },
                }
              : {}),
            ts: samples.map((s) => s.ts),
            lon: samples.map((s) => toReplayCoord(s.lon)),
            lat: samples.map((s) => toReplayCoord(s.lat)),
            ...(anyHeading ? { heading: samples.map((s) => s.heading ?? null) } : {}),
            ...(anySpeed
              ? { speed: samples.map((s) => (s.speed == null ? null : toReplaySpeed(s.speed))) }
              : {}),
          };
        }),
      },
      ...extra,
    },
  };
  return ReplayWindowSchema.parse(win);
}

export function bikeWindow(
  from: number,
  stations: {
    id: string;
    init?: { dt: number; bikes: number; docks: number };
    samples?: { ts: number; bikes: number; docks: number }[];
  }[],
): ReplayWindow {
  return ReplayWindowSchema.parse({
    v: 1,
    from,
    to: from + WINDOW_MS,
    resolution: "raw",
    layers: {
      bike: {
        kind: "station",
        stations: stations.map((s) => ({
          id: s.id,
          lon: toReplayCoord(-8.4),
          lat: toReplayCoord(43.37),
          ...(s.init ? { init: s.init } : {}),
          ts: (s.samples ?? []).map((x) => x.ts),
          bikes: (s.samples ?? []).map((x) => x.bikes),
          docks: (s.samples ?? []).map((x) => x.docks),
        })),
      },
    },
  });
}

export function emptyLayersWindow(from: number): ReplayWindow {
  return ReplayWindowSchema.parse({
    v: 1,
    from,
    to: from + WINDOW_MS,
    resolution: "raw",
    layers: {
      bus: { kind: "mobile", tracks: [] },
      bike: { kind: "station", stations: [] },
      weather: { kind: "series", series: [] },
    },
  });
}
