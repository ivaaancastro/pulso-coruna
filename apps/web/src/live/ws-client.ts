import type { ConnectionState } from "./types";

/** Subconjunto de WebSocket que usamos; permite inyectar un doble en los tests. */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}

export interface BackoffOptions {
  baseMs: number;
  capMs: number;
  random: () => number;
}

/** Espera exponencial con tope y «equal jitter»: entre la mitad y el total del techo. */
export function backoffDelay(attempt: number, { baseMs, capMs, random }: BackoffOptions): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
  return ceiling / 2 + random() * (ceiling / 2);
}

export interface WsClientOptions {
  url: string;
  createSocket: (url: string) => SocketLike;
  onMessage: (data: unknown) => void;
  onState: (state: ConnectionState, attempt: number) => void;
  baseMs?: number;
  capMs?: number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /**
   * Watchdog de silencio: si pasan tantos ms sin ningún mensaje (o sin llegar a abrir), el socket se
   * da por muerto (conexión semiabierta) y se reconecta. 0 o ausente = sin watchdog. El servidor solo
   * envía deltas cuando hay cambios, así que debe ser holgado.
   */
  silenceMs?: number;
}

export interface WsClient {
  connect(): void;
  close(): void;
  /** Reconecta ya (evento `online`): descarta el socket actual, aunque parezca abierto, y la espera pendiente. */
  retryNow(): void;
}

/**
 * Cliente con reconexión automática. El contador de intentos solo se pone a cero al recibir el
 * primer mensaje de una conexión (el snapshot): un servidor que acepta y cierra de inmediato no
 * se martillea.
 */
export function createWsClient(opts: WsClientOptions): WsClient {
  const baseMs = opts.baseMs ?? 1000;
  const capMs = opts.capMs ?? 30_000;
  const random = opts.random ?? Math.random;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  const silenceMs = opts.silenceMs ?? 0;
  let socket: SocketLike | null = null;
  let timer: unknown = null;
  let watchdog: unknown = null;
  let attempt = 0;
  let closed = false;

  const stopWatchdog = (): void => {
    if (watchdog !== null) clearTimer(watchdog);
    watchdog = null;
  };

  const detach = (current: SocketLike): void => {
    current.onopen = current.onmessage = current.onclose = current.onerror = null;
  };

  const scheduleRetry = (): void => {
    if (closed || timer !== null) return;
    opts.onState("reconnecting", attempt);
    const delay = backoffDelay(attempt, { baseMs, capMs, random });
    attempt++;
    timer = setTimer(() => {
      timer = null;
      open();
    }, delay);
  };

  const open = (): void => {
    if (closed) return;
    opts.onState(attempt === 0 ? "connecting" : "reconnecting", attempt);
    let current: SocketLike;
    try {
      current = opts.createSocket(opts.url);
    } catch {
      scheduleRetry();
      return;
    }
    socket = current;
    const arm = (): void => {
      if (silenceMs <= 0) return;
      stopWatchdog();
      watchdog = setTimer(() => {
        watchdog = null;
        if (socket !== current) return;
        // Sin mensajes en todo este tiempo: conexión semiabierta. Se cierra y se reconecta.
        socket = null;
        detach(current);
        try {
          current.close();
        } catch {
          // ya estaba cerrado
        }
        scheduleRetry();
      }, silenceMs);
    };
    arm();
    current.onopen = () => {
      if (socket === current) opts.onState("open", attempt);
    };
    current.onmessage = (ev) => {
      if (socket !== current) return;
      if (attempt !== 0) {
        // Primer mensaje tras reconectar: ahora sí está sana (un servidor que abre y cierra al instante no).
        attempt = 0;
        opts.onState("open", 0);
      }
      arm();
      opts.onMessage(ev.data);
    };
    current.onerror = () => {
      // El cierre llega después; la reconexión se programa allí.
    };
    current.onclose = () => {
      if (socket !== current) return;
      socket = null;
      stopWatchdog();
      scheduleRetry();
    };
  };

  return {
    connect() {
      closed = false;
      if (socket || timer !== null) return;
      open();
    },
    retryNow() {
      if (closed) return;
      if (timer !== null) clearTimer(timer);
      timer = null;
      stopWatchdog();
      const current = socket;
      socket = null;
      if (current) {
        detach(current);
        try {
          current.close();
        } catch {
          // ya estaba cerrado
        }
      }
      attempt = 0;
      open();
    },
    close() {
      closed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      stopWatchdog();
      const current = socket;
      socket = null;
      if (current) {
        detach(current);
        current.close();
      }
      opts.onState("closed", attempt);
    },
  };
}
