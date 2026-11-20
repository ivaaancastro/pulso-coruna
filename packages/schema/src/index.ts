export * from "./layers.js";
export * from "./entity.js";
export * from "./station.js";
export * from "./observation.js";
export * from "./ws.js";
export * from "./replay.js";
export * from "./pulse.js";

export interface Adapter<T> {
  id: string;
  intervalMs: number;
  fetch(signal: AbortSignal): Promise<unknown>;
  parse(raw: unknown): T[];
}
