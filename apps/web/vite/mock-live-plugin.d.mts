import type { Plugin } from "vite";

export interface MockLiveOptions {
  enabled?: boolean;
  buses?: number;
  tickMs?: number;
}

export function mockLivePlugin(options?: MockLiveOptions): Plugin;
