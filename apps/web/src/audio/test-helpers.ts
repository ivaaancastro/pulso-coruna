import type {
  AudioContextLike,
  BufferLike,
  BufferSourceLike,
  CompressorLike,
  FilterLike,
  GainLike,
  NodeLike,
  OscillatorLike,
  ParamLike,
} from "./context";

/** Utilidades solo para tests (no se importan desde código de producción). */

export class FakeParam implements ParamLike {
  value = 0;
  calls: { kind: string; value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number): void {
    this.calls.push({ kind: "set", value, time });
    this.value = value;
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.calls.push({ kind: "ramp", value, time });
  }
  setTargetAtTime(target: number, time: number): void {
    this.calls.push({ kind: "target", value: target, time });
  }
  cancelScheduledValues(): void {
    this.calls.push({ kind: "cancel", value: 0, time: 0 });
  }
}

export class FakeNode implements NodeLike {
  connected = new Set<unknown>();
  disconnected = false;
  onended: ((ev: Event) => void) | null = null;
  started: number | null = null;
  stopped: number | null = null;
  constructor(
    readonly kind: string,
    readonly ctx: FakeContext,
  ) {
    ctx.nodes.push(this);
  }
  connect(destination: unknown): void {
    this.connected.add(destination);
  }
  disconnect(): void {
    this.connected.clear();
    this.disconnected = true;
  }
  start(when = 0): void {
    this.started = when;
  }
  stop(when = 0): void {
    this.stopped = when;
  }
  /** Simula el fin natural de la fuente. */
  end(): void {
    this.onended?.(new Event("ended"));
  }
}

export class FakeGain extends FakeNode implements GainLike {
  readonly gain = new FakeParam();
}
class FakeOsc extends FakeNode implements OscillatorLike {
  type: OscillatorType = "sine";
  readonly frequency = new FakeParam();
}
export class FakeFilter extends FakeNode implements FilterLike {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}
class FakeCompressor extends FakeNode implements CompressorLike {
  readonly threshold = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
}
class FakeBufferSource extends FakeNode implements BufferSourceLike {
  buffer: BufferLike | null = null;
  loop = false;
}

/** `AudioContext` simulado: sin sonido, con el reloj controlado por el test. */
export class FakeContext implements AudioContextLike {
  currentTime = 0;
  sampleRate = 8000;
  state: AudioContextState = "running";
  nodes: FakeNode[] = [];
  closed = false;
  readonly destination: FakeNode = new FakeNode("destination", this);

  createGain(): GainLike {
    return new FakeGain("gain", this);
  }
  createOscillator(): OscillatorLike {
    return new FakeOsc("osc", this);
  }
  createBiquadFilter(): FilterLike {
    return new FakeFilter("filter", this);
  }
  createDynamicsCompressor(): CompressorLike {
    return new FakeCompressor("compressor", this);
  }
  createBuffer(_channels: number, length: number): BufferLike {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  createBufferSource(): BufferSourceLike {
    return new FakeBufferSource("buffer", this);
  }
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = "suspended";
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = "closed";
    this.closed = true;
    return Promise.resolve();
  }

  /** Nodos creados que siguen conectados (sin `disconnect`). */
  live(): FakeNode[] {
    return this.nodes.filter((n) => !n.disconnected && n !== this.destination);
  }
  oscillators(): FakeNode[] {
    return this.nodes.filter((n) => n.kind === "osc");
  }
}

export const noWait = (): Promise<void> => Promise.resolve();
