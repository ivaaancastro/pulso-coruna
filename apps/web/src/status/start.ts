import { defaultFetchHealth, resolveHealthUrl, type FetchHealth } from "../live/health";
import type { CreditsPanel, StatusView } from "./credits";
import { deriveRows, parseHealthReport } from "./model";
import { SOURCES } from "./sources";

export interface StatusStartOptions {
  panel: Pick<CreditsPanel, "update">;
  /** URL del stream de nuestra API (`live/config.ts`); de ella se deriva `/api/v1/health`. */
  streamUrl: string;
  fetchHealth?: FetchHealth;
}

export interface StatusHandle {
  /** Consulta `/api/v1/health` y pinta el resultado (cancela la consulta anterior). */
  refresh(): Promise<void>;
  /** Cancela la consulta en vuelo (al cerrar el panel). */
  cancel(): void;
}

/**
 * Chunk diferido del estado por fuente (M8.4): solo habla con nuestra API. Pide el informe (la API
 * responde 503 con cuerpo válido si la BD cae: también cuenta) y lo traduce al vocabulario de las capas.
 */
export function startStatus(opts: StatusStartOptions): StatusHandle {
  const url = resolveHealthUrl(opts.streamUrl);
  const fetchHealth = opts.fetchHealth ?? defaultFetchHealth;
  let abort: AbortController | null = null;

  const cancel = (): void => {
    abort?.abort();
    abort = null;
  };

  return {
    cancel,
    async refresh() {
      if (!url) return opts.panel.update({ kind: "noapi" });
      cancel();
      const controller = new AbortController();
      abort = controller;
      opts.panel.update({ kind: "loading" });
      let next: StatusView;
      try {
        const report = parseHealthReport(await fetchHealth(url, controller.signal));
        next = report
          ? {
              kind: "ready",
              rows: deriveRows(SOURCES, report),
              ts: report.ts,
              dbDown: !report.db,
            }
          : { kind: "error" };
      } catch {
        next = { kind: "error" };
      }
      if (!controller.signal.aborted) opts.panel.update(next);
    },
  };
}
