import "./pwa.css";
import type { Translate } from "../i18n";

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** Aviso discreto abajo (estado de conexión y nueva versión). Texto siempre vía i18n. */
function createNotice(): {
  show(text: string, action?: { label: string; run(): void }): void;
  hide(): void;
} {
  const el = document.createElement("div");
  el.className = "pwa-notice";
  el.setAttribute("role", "status");
  el.hidden = true;
  const text = document.createElement("span");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pwa-notice__action";
  el.append(text, button);
  document.body.append(el);
  let run: (() => void) | undefined;
  button.addEventListener("click", () => run?.());
  return {
    show(message, action) {
      text.textContent = message;
      button.hidden = !action;
      button.textContent = action?.label ?? "";
      run = action?.run;
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
  };
}

/** Solo se llama en build de producción. Registra el SW y gestiona avisos de actualización y conexión. */
export function registerServiceWorker(t: Translate): void {
  if (!("serviceWorker" in navigator)) return;
  const notice = createNotice();
  let updateReady = false;
  let reloadRequested = false;

  const offerUpdate = (worker: ServiceWorker): void => {
    updateReady = true;
    notice.show(t("pwa.update"), {
      label: t("pwa.update.action"),
      run: () => {
        reloadRequested = true;
        worker.postMessage({ type: "SKIP_WAITING" });
      },
    });
  };

  const syncConnection = (): void => {
    if (!navigator.onLine) notice.show(t("pwa.offline"));
    else if (!updateReady) notice.hide();
  };
  window.addEventListener("offline", syncConnection);
  window.addEventListener("online", syncConnection);
  syncConnection();

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadRequested) window.location.reload();
  });

  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then((registration) => {
      // `controller` nulo = primera instalación: no hay versión anterior que sustituir.
      if (registration.waiting && navigator.serviceWorker.controller) {
        offerUpdate(registration.waiting);
      }
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            offerUpdate(worker);
          }
        });
      });
      const check = (): void => {
        if (navigator.onLine) void registration.update().catch(() => undefined);
      };
      setInterval(check, UPDATE_CHECK_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    })
    .catch(() => undefined); // sin SW la web sigue funcionando
}
