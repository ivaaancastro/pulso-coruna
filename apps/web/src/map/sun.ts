/**
 * Posición solar aproximada (±0,5°, suficiente para decidir la luz del mapa).
 * Todo en UTC epoch ms; no interviene ninguna zona horaria. Fórmulas del Astronomical Almanac
 * (versión simplificada).
 */
export interface SunPosition {
  /** Elevación sobre el horizonte, grados (negativa = bajo el horizonte). */
  elevation: number;
  /** Azimut desde el norte en sentido horario, grados [0, 360). */
  azimuth: number;
  /** true entre medianoche solar y mediodía solar (amanecer), false por la tarde. */
  morning: boolean;
}

/** A Coruña (Torre de Hércules). */
export const CORUNA = { lat: 43.3862, lon: -8.4064 } as const;

const RAD = Math.PI / 180;

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

export function sunPosition(epochMs: number, lat = CORUNA.lat, lon = CORUNA.lon): SunPosition {
  const jd = epochMs / 86_400_000 + 2_440_587.5;
  const n = jd - 2_451_545.0;
  const meanLon = mod(280.46 + 0.9856474 * n, 360);
  const anomaly = mod(357.528 + 0.9856003 * n, 360) * RAD;
  const eclLon = (meanLon + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
  const obliquity = (23.439 - 0.0000004 * n) * RAD;

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclLon));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclLon), Math.cos(eclLon));

  const gmstDeg = mod((18.697374558 + 24.06570982441908 * n) * 15, 360);
  const hourAngle = (mod(gmstDeg + lon, 360) - rightAscension / RAD) * RAD;

  const latRad = lat * RAD;
  const sinElev =
    Math.sin(latRad) * Math.sin(declination) +
    Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElev))) / RAD;

  const azimuth = mod(
    Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(latRad) - Math.tan(declination) * Math.cos(latRad),
    ) /
      RAD +
      180,
    360,
  );
  const morning = Math.sin(hourAngle) < 0;
  return { elevation, azimuth, morning };
}
