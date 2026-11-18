import type { Translate } from "../i18n";

/** Placeholder: el índice real llega con la API. El valor es ficticio y se etiqueta como tal. */
export const PLACEHOLDER_PULSE = 62;

export function createPulseIndex(t: Translate, value = PLACEHOLDER_PULSE): HTMLElement {
  const root = document.createElement("section");
  root.className = "pulse";
  root.setAttribute("aria-label", t("pulse.label"));

  const label = document.createElement("p");
  label.className = "pulse__label";
  label.textContent = t("pulse.label");

  const figure = document.createElement("p");
  figure.className = "pulse__value";
  const number = document.createElement("span");
  number.className = "pulse__number";
  number.textContent = String(value);
  const scale = document.createElement("span");
  scale.className = "pulse__scale";
  scale.textContent = t("pulse.scale");
  figure.append(number, " ", scale);

  const note = document.createElement("p");
  note.className = "pulse__note";
  note.textContent = t("pulse.placeholder");

  root.append(label, figure, note);
  return root;
}
