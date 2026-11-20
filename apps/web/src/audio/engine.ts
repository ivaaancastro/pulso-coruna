import type {
  AudioContextLike,
  BufferSourceLike,
  FilterLike,
  GainLike,
  NodeLike,
  SourceLike,
} from "./context";
import { degreeToHz } from "./scale";
import { PRIORITY, type MusicEvent, type SoundLayer } from "./score";
import { WIND_MAX_MS, type SoundState } from "./state";
import { VoicePool } from "./voices";

/** Techo de la ganancia maestra (antes del limitador). */
export const MASTER_CAP = 0.5;
/** Ataque y relajación mínimos de toda envolvente: por debajo se oyen chasquidos. */
export const ATTACK_SEC = 0.008;
export const RELEASE_SEC = 0.02;
const FADE_IN_SEC = 0.4;
const FADE_OUT_SEC = 0.15;
/** Nivel de cada capa en la mezcla. */
const LAYER_LEVEL: Record<SoundLayer, number> = {
  bus: 0.8,
  bike: 0.9,
  sea: 1,
  wind: 1,
  air: 0.9,
  ship: 0.9,
  plane: 0.9,
};

export interface AudioEngine {
  readonly ctx: AudioContextLike;
  /** Voces reservadas ahora mismo (permanentes + planificadas). Nunca supera `maxVoices`. */
  activeVoices(): number;
  readonly maxVoices: number;
  /** Programa un evento a la hora `when` del contexto. `false` si se descartó (sin voz libre). */
  play(event: MusicEvent, when: number): boolean;
  /** Ajusta las capas continuas (mar y viento) con rampas suaves. */
  setContinuous(state: SoundState): void;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  /** Fundido de salida, libera todos los nodos y cierra el contexto. Idempotente. */
  dispose(): Promise<void>;
}

interface Voice {
  /** Corta con una rampa corta (robo de voz o apagado). */
  kill(now: number): void;
  /** Desconecta todo. */
  free(): void;
}

export interface EngineOptions {
  maxVoices?: number;
  /** Para los timers del fundido de salida en tests. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * Motor de síntesis sobre Web Audio nativo: voces → ganancia por capa → maestra (con tope) →
 * compresor como limitador → salida. Las voces permanentes (drone del mar, viento) y las
 * transitorias salen del mismo `VoicePool` (≤ 16).
 */
export function createEngine(ctx: AudioContextLike, options: EngineOptions = {}): AudioEngine {
  const pool = new VoicePool(options.maxVoices);
  const voices = new Map<number, Voice>();
  const wait = options.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let disposed = false;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(MASTER_CAP, ctx.currentTime + FADE_IN_SEC);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 4;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  master.connect(limiter);
  limiter.connect(ctx.destination);

  const layerGain = new Map<SoundLayer, GainLike>();
  for (const [layer, level] of Object.entries(LAYER_LEVEL) as [SoundLayer, number][]) {
    const g = ctx.createGain();
    g.gain.value = level;
    g.connect(master);
    layerGain.set(layer, g);
  }
  const out = (layer: SoundLayer): GainLike => {
    const g = layerGain.get(layer);
    if (!g) throw new Error(`capa sin canal: ${layer}`);
    return g;
  };

  // Ruido blanco de 2 s reutilizable (hats y viento).
  const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const noise = (loop: boolean): BufferSourceLike => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = loop;
    return src;
  };

  /** Envolvente ataque→caída a 0: siempre arranca y termina en silencio. */
  const envelope = (env: GainLike, when: number, peak: number, dur: number): void => {
    const attack = Math.min(ATTACK_SEC, dur / 2);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak, when + attack);
    env.gain.linearRampToValueAtTime(0, when + dur);
  };

  const register = (id: number, sources: SourceLike[], nodes: NodeLike[], env: GainLike): void => {
    let freed = false;
    const free = (): void => {
      if (freed) return;
      freed = true;
      for (const n of nodes) n.disconnect();
      voices.delete(id);
      pool.release(id);
    };
    const first = sources[0];
    if (first) first.onended = free;
    voices.set(id, {
      free,
      kill(now) {
        env.gain.cancelScheduledValues(now);
        env.gain.setTargetAtTime(0, now, RELEASE_SEC / 3);
        for (const s of sources) s.stop(now + RELEASE_SEC * 2);
        // Sin esperar a `onended`: la voz ya no cuenta para el tope.
        voices.delete(id);
        pool.release(id);
        void wait(RELEASE_SEC * 2000 + 20).then(free);
      },
    });
  };

  const play = (e: MusicEvent, when: number): boolean => {
    if (disposed) return false;
    const now = ctx.currentTime;
    for (const id of pool.expire(now)) voices.get(id)?.free();
    const start = Math.max(when, now);
    const end = start + e.dur + RELEASE_SEC;
    const got = pool.acquire(e.priority, start, end);
    if (!got) return false;
    if (got.stolen !== null) voices.get(got.stolen)?.kill(now);

    const env = ctx.createGain();
    env.connect(out(e.layer));
    const nodes: NodeLike[] = [env];
    const sources: SourceLike[] = [];

    if (e.kind === "hat") {
      const src = noise(false);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 6000;
      src.connect(hp);
      hp.connect(env);
      nodes.push(src, hp);
      sources.push(src);
      src.start(start);
      src.stop(start + e.dur + RELEASE_SEC);
    } else {
      const osc = ctx.createOscillator();
      osc.type = e.kind === "note" ? "triangle" : e.kind === "horn" ? "triangle" : "sine";
      osc.frequency.setValueAtTime(e.freq, start);
      if (e.kind === "kick") {
        osc.frequency.setValueAtTime(e.freq * 2.2, start);
        osc.frequency.linearRampToValueAtTime(e.freq, start + e.dur * 0.5);
      } else if (e.kind === "sweep") {
        osc.frequency.linearRampToValueAtTime(e.freq * 1.5, start + e.dur);
      }
      if (e.kind === "horn") {
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 500;
        osc.connect(lp);
        lp.connect(env);
        nodes.push(osc, lp);
      } else {
        osc.connect(env);
        nodes.push(osc);
      }
      sources.push(osc);
      osc.start(start);
      osc.stop(start + e.dur + RELEASE_SEC);
    }
    envelope(env, start, e.gain, e.dur);
    register(got.id, sources, nodes, env);
    return true;
  };

  // --- capas continuas: drone del mar y viento (2 voces permanentes) ---
  const droneGain = ctx.createGain();
  const droneFilter: FilterLike = ctx.createBiquadFilter();
  const droneRoot = ctx.createOscillator();
  const droneFifth = ctx.createOscillator();
  const droneOsc = [droneRoot, droneFifth];
  const lfo = ctx.createOscillator();
  const lfoDepth = ctx.createGain();
  const windGain = ctx.createGain();
  const windFilter = ctx.createBiquadFilter();
  const windSrc = noise(true);
  const continuousNodes: NodeLike[] = [
    droneGain,
    droneFilter,
    ...droneOsc,
    lfo,
    lfoDepth,
    windGain,
    windFilter,
    windSrc,
  ];
  const continuousSources: SourceLike[] = [...droneOsc, lfo, windSrc];

  const droneVoice = pool.acquire(PRIORITY.sea, ctx.currentTime, Number.POSITIVE_INFINITY);
  const windVoice = pool.acquire(PRIORITY.wind, ctx.currentTime, Number.POSITIVE_INFINITY);
  const t0 = ctx.currentTime;
  if (droneVoice) {
    droneRoot.type = "sine";
    droneRoot.frequency.value = degreeToHz(-10); // La1
    droneFifth.type = "sine";
    droneFifth.frequency.value = degreeToHz(-7); // Mi2: la quinta
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 260;
    droneFilter.Q.value = 0.7;
    droneGain.gain.setValueAtTime(0, t0);
    droneGain.gain.linearRampToValueAtTime(0.22, t0 + FADE_IN_SEC * 4);
    lfo.type = "sine";
    lfo.frequency.value = 0.08;
    lfoDepth.gain.value = 60;
    lfo.connect(lfoDepth);
    lfoDepth.connect(droneFilter.frequency);
    for (const o of droneOsc) {
      o.connect(droneFilter);
      o.start(t0);
    }
    lfo.start(t0);
    droneFilter.connect(droneGain);
    droneGain.connect(out("sea"));
  }
  if (windVoice) {
    windFilter.type = "bandpass";
    windFilter.frequency.value = 400;
    windFilter.Q.value = 0.8;
    windGain.gain.setValueAtTime(0, t0);
    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(out("wind"));
    windSrc.start(t0);
  }

  const setContinuous = (state: SoundState): void => {
    if (disposed) return;
    const now = ctx.currentTime;
    if (droneVoice) {
      const tide = state.sea.tide ?? 0.5;
      droneFilter.frequency.setTargetAtTime(120 + 500 * tide, now, 1.5);
      droneGain.gain.setTargetAtTime(state.sea.tide === null ? 0.12 : 0.18 + 0.1 * tide, now, 1.5);
    }
    if (windVoice) {
      const speed = state.wind.speed;
      const level = speed === null ? 0 : Math.min(1, speed / WIND_MAX_MS);
      windFilter.frequency.setTargetAtTime(250 + 1600 * level, now, 1);
      windGain.gain.setTargetAtTime(level * 0.2, now, 1);
    }
  };

  return {
    ctx,
    maxVoices: pool.max,
    activeVoices: () => pool.size,
    play,
    setContinuous,
    suspend: () => ctx.suspend(),
    resume: () => ctx.resume(),
    async dispose() {
      if (disposed) return;
      disposed = true;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, FADE_OUT_SEC / 3);
      await wait(FADE_OUT_SEC * 1000);
      for (const s of continuousSources) {
        try {
          s.stop();
        } catch {
          /* ya parada o sin arrancar */
        }
      }
      for (const v of [...voices.values()]) v.free();
      for (const n of continuousNodes) n.disconnect();
      for (const g of layerGain.values()) g.disconnect();
      master.disconnect();
      limiter.disconnect();
      pool.clear();
      voices.clear();
      await ctx.close().catch(() => undefined);
    },
  };
}
