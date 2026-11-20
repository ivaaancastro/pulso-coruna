/**
 * Subconjunto de Web Audio que usa el motor. Permite simular el `AudioContext` en los tests
 * (sin sonido real en CI). Este módulo es el único que entra en el JS inicial: solo tipos y la
 * creación del contexto, que debe ocurrir dentro del gesto del usuario.
 */
export interface ParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(target: number, time: number, timeConstant: number): unknown;
  cancelScheduledValues(time: number): unknown;
}

export interface NodeLike {
  connect(destination: NodeLike | ParamLike): unknown;
  disconnect(): void;
}

export interface SourceLike extends NodeLike {
  start(when?: number): void;
  stop(when?: number): void;
  onended: ((ev: Event) => void) | null;
}

export interface GainLike extends NodeLike {
  readonly gain: ParamLike;
}

export interface OscillatorLike extends SourceLike {
  type: OscillatorType;
  readonly frequency: ParamLike;
}

export interface FilterLike extends NodeLike {
  type: BiquadFilterType;
  readonly frequency: ParamLike;
  readonly Q: ParamLike;
}

export interface CompressorLike extends NodeLike {
  readonly threshold: ParamLike;
  readonly knee: ParamLike;
  readonly ratio: ParamLike;
  readonly attack: ParamLike;
  readonly release: ParamLike;
}

export interface BufferLike {
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceLike extends SourceLike {
  buffer: BufferLike | null;
  loop: boolean;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: AudioContextState;
  readonly destination: NodeLike;
  createGain(): GainLike;
  createOscillator(): OscillatorLike;
  createBiquadFilter(): FilterLike;
  createDynamicsCompressor(): CompressorLike;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createBufferSource(): BufferSourceLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Crea el `AudioContext` y lo reanuda. Hay que llamarlo de forma SÍNCRONA dentro del manejador del
 * gesto (clic/tecla): iOS Safari solo permite `resume()` ahí. `null` si el navegador no tiene Web Audio.
 */
export function createUserContext(
  win: { AudioContext?: new (opts?: AudioContextOptions) => AudioContextLike } = window,
): AudioContextLike | null {
  const Ctor = win.AudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor({ latencyHint: "interactive" });
  void ctx.resume().catch(() => undefined);
  return ctx;
}
