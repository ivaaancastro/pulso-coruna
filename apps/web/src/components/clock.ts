import { INTL_LOCALE, type Locale, type Translate } from "../i18n";
import { formatMadridDate, formatMadridTime, msToNextMinute } from "../time/format";

export interface Clock {
  element: HTMLElement;
  render(nowMs: number): void;
  start(now?: () => number): () => void;
}

export function createClock(t: Translate, locale: Locale): Clock {
  const intl = INTL_LOCALE[locale];
  const root = document.createElement("section");
  root.className = "clock";
  root.setAttribute("aria-label", t("clock.label"));

  const time = document.createElement("time");
  time.className = "clock__time";
  const date = document.createElement("p");
  date.className = "clock__date";
  root.append(time, date);

  const render = (nowMs: number): void => {
    time.textContent = formatMadridTime(nowMs, intl);
    time.dateTime = new Date(nowMs).toISOString();
    date.textContent = formatMadridDate(nowMs, intl);
  };

  const start = (now: () => number = Date.now): (() => void) => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      const ms = now();
      render(ms);
      timer = setTimeout(tick, msToNextMinute(ms) + 20);
    };
    tick();
    return () => clearTimeout(timer);
  };

  return { element: root, render, start };
}
