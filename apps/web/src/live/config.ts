export interface LiveEnv {
  /** `import.meta.env.DEV` */
  dev: boolean;
  /** `import.meta.env.VITE_LIVE_URL`: URL absoluta ws(s):// o ruta (`/api/v1/stream`). */
  configured?: string;
}

export interface LocationLike {
  protocol: string;
  host: string;
}

export const DEFAULT_STREAM_PATH = "/api/v1/stream";

/**
 * URL del WebSocket de nuestra API, o `null` si el stream está desactivado.
 * - Producción: solo si se configuró `VITE_LIVE_URL` en el build (hasta que exista la API desplegada).
 * - Desarrollo: `/api/v1/stream` del propio servidor (el mock de desarrollo o un proxy), salvo `?live=0`.
 * El navegador nunca habla con fuentes externas: la URL apunta a nuestra API.
 */
export function resolveStreamUrl(
  env: LiveEnv,
  search: string,
  location: LocationLike,
): string | null {
  if (env.dev && new URLSearchParams(search).get("live") === "0") return null;
  const configured = env.configured?.trim();
  const target = configured || (env.dev ? DEFAULT_STREAM_PATH : null);
  if (!target) return null;
  if (/^wss?:\/\//.test(target)) return target;
  if (!target.startsWith("/")) return null;
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${target}`;
}
