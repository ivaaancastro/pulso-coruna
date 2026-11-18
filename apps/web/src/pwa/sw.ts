// Service worker de Pulso. Lógica pura en `sw-logic.ts`; aquí solo el pegamento con las APIs de worker.
// Se empaqueta aparte (`vite/sw-plugin.mjs`) a `dist/sw.js`, que inyecta `__SW_VERSION__` y `__PRECACHE__`.
import {
  TILES_CACHE,
  TILES_PATH,
  contentRange,
  parseRange,
  routeRequest,
  shellCacheName,
  shouldPrefetchTiles,
  staleCaches,
} from "./sw-logic";

declare const __SW_VERSION__: string;
declare const __PRECACHE__: string[];

interface ExtendableEvt {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvt extends ExtendableEvt {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}
interface SwScope {
  registration: { scope: string };
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: "install" | "activate", fn: (e: ExtendableEvt) => void): void;
  addEventListener(type: "fetch", fn: (e: FetchEvt) => void): void;
  addEventListener(type: "message", fn: (e: { data: unknown }) => void): void;
}

// `self` está tipado como Window por la lib DOM del paquete; lo estrechamos a lo que usamos.
const sw = self as unknown as SwScope;
const SHELL = shellCacheName(__SW_VERSION__);
const scopeUrl = (path: string): string => new URL(path, sw.registration.scope).href;

sw.addEventListener("install", (event) => {
  // Sin skipWaiting: la versión nueva espera a que el usuario acepte el aviso (o a la siguiente carga).
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) =>
        cache.addAll(__PRECACHE__.map((p) => new Request(scopeUrl(p), { cache: "reload" }))),
      ),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(staleCaches(names, __SW_VERSION__).map((n) => caches.delete(n))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener("message", (event) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === "SKIP_WAITING") void sw.skipWaiting();
});

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  const strategy = routeRequest({
    method: request.method,
    url: request.url,
    mode: request.mode,
    origin: sw.location.origin,
  });
  switch (strategy) {
    case "bypass":
      return; // el navegador gestiona la petición (API, WebSocket, otros orígenes)
    case "navigation":
      event.respondWith(navigation(request));
      return;
    case "tiles":
      event.respondWith(tiles(request, event));
      return;
    case "immutable":
      event.respondWith(cacheFirst(request));
      return;
    case "stale-while-revalidate":
      event.respondWith(staleWhileRevalidate(request, event));
  }
});

const offline = (): Response => new Response("", { status: 503, statusText: "Offline" });

async function navigation(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL);
  const shell = await cache.match(scopeUrl("./"), { ignoreSearch: true });
  if (shell) return shell;
  try {
    return await fetch(request);
  } catch {
    return offline();
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) void cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request: Request, event: ExtendableEvt): Promise<Response> {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  const refresh = fetch(request).then((res) => {
    if (res.ok) void cache.put(request, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => undefined));
    return hit;
  }
  try {
    return await refresh;
  } catch {
    return offline();
  }
}

// PMTiles: la Cache API no admite respuestas 206, así que se guarda el fichero entero (una vez) y
// las peticiones Range se sirven recortando el blob cacheado. Sin caché, la petición pasa intacta.
let tilesInFlight = false;

async function tiles(request: Request, event: ExtendableEvt): Promise<Response> {
  const key = scopeUrl(TILES_PATH.slice(1));
  const cache = await caches.open(TILES_CACHE);
  const cached = await cache.match(key);
  if (!cached) {
    if (shouldPrefetchTiles(false, tilesInFlight)) {
      tilesInFlight = true;
      event.waitUntil(
        fetch(key)
          .then((res) => (res.status === 200 ? cache.put(key, res) : undefined))
          .catch(() => undefined)
          .finally(() => {
            tilesInFlight = false;
          }),
      );
    }
    return fetch(request);
  }
  const blob = await cached.blob();
  const headers = new Headers({
    "Content-Type": cached.headers.get("Content-Type") ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
  });
  const parsed = parseRange(request.headers.get("Range"), blob.size);
  if (parsed.kind === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${blob.size}`);
    return new Response(null, { status: 416, headers });
  }
  if (parsed.kind === "none") return new Response(blob, { status: 200, headers });
  const { range } = parsed;
  headers.set("Content-Range", contentRange(range, blob.size));
  return new Response(blob.slice(range.start, range.end + 1), { status: 206, headers });
}
