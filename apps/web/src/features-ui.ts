// UI de las funciones tras flag (`features.ts`), agrupada en un solo chunk diferido: con todo apagado
// (v1 simple) `main.ts` nunca lo importa; con flags se descarga una vez en vez de cinco chunks sueltos.
export { createUserContext } from "./audio/context";
export { createClipButton } from "./clip/button";
export { createModeSelector } from "./components/mode-selector";
export { createPulseIndex } from "./components/pulse-index";
export { deriveSnapshot } from "./pulse/model";
