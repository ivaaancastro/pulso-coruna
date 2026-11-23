import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coverRect } from "./geometry";
import { MIME_CANDIDATES, clipFileName, extensionOf, pickMimeType } from "./mime";
import {
  STOP_GRACE_MS,
  createClipRecorder,
  type RecorderCtor,
  type RecorderLike,
} from "./recorder";
import type { ClipProgress } from "./types";

describe("pickMimeType", () => {
  it("devuelve el primero soportado, en orden de preferencia (mp4 antes que webm)", () => {
    expect(pickMimeType(() => true)).toBe(MIME_CANDIDATES[0]);
    expect(pickMimeType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9");
    expect(pickMimeType((t) => t === "video/webm")).toBe("video/webm");
  });
  it("ninguno → null; un navegador que lanza se trata como no soportado", () => {
    expect(pickMimeType(() => false)).toBeNull();
    expect(
      pickMimeType((t) => {
        if (t.includes("avc1")) throw new Error("x");
        return t === "video/mp4";
      }),
    ).toBe("video/mp4");
  });
  it("extensión y nombre de archivo en UTC", () => {
    expect(extensionOf("video/mp4;codecs=avc1.42E01E")).toBe("mp4");
    expect(extensionOf("video/webm")).toBe("webm");
    expect(clipFileName(Date.UTC(2026, 10, 20, 13, 41, 59), "video/webm")).toBe(
      "pulso-coruna-20261120T1341Z.webm",
    );
  });
});

describe("coverRect", () => {
  it("origen apaisado: recorta a lo ancho, centrado", () => {
    const r = coverRect(1600, 900, 1080, 1920);
    expect(r.h).toBe(900);
    expect(r.w).toBeCloseTo(506.25);
    expect(r.x).toBeCloseTo((1600 - 506.25) / 2);
    expect(r.y).toBe(0);
  });
  it("origen más estrecho que 9:16: recorta a lo alto", () => {
    const r = coverRect(780, 1688, 1080, 1920);
    expect(r.w).toBe(780);
    expect(r.h).toBeCloseTo(780 / 0.5625);
    expect(r.y).toBeCloseTo((1688 - r.h) / 2);
  });
  it("misma proporción: todo el origen", () => {
    expect(coverRect(540, 960, 1080, 1920)).toEqual({ x: 0, y: 0, w: 540, h: 960 });
  });
});

class FakeRecorder implements RecorderLike {
  static supported = new Set<string>(["video/mp4"]);
  static last: FakeRecorder | undefined;
  static isTypeSupported = (t: string): boolean => FakeRecorder.supported.has(t);
  state = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  options: unknown;
  /** Si es true, `stop()` no emite `stop`. */
  stuck = false;
  constructor(_stream: MediaStream, options: unknown) {
    this.options = options;
    FakeRecorder.last = this;
  }
  start(): void {
    this.state = "recording";
  }
  stop(): void {
    this.state = "inactive";
    if (this.stuck) return;
    this.ondataavailable?.({ data: new Blob(["abc"]) });
    this.onstop?.();
  }
}
const Ctor = FakeRecorder as unknown as RecorderCtor;
const stream = {} as MediaStream;

describe("createClipRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecorder.supported = new Set(["video/mp4"]);
    FakeRecorder.last = undefined;
  });
  afterEach(() => vi.useRealTimers());

  it("graba 15 s, informa del progreso y entrega el archivo", async () => {
    const seen: ClipProgress[] = [];
    const rec = createClipRecorder({ stream, Recorder: Ctor, onProgress: (p) => seen.push(p) });
    const result = rec.start();
    expect(seen[0]).toMatchObject({ phase: "recording", elapsedMs: 0, durationMs: 15_000 });
    await vi.advanceTimersByTimeAsync(7_000);
    expect(FakeRecorder.last?.state).toBe("recording");
    expect(seen.at(-1)?.elapsedMs).toBe(7_000);
    await vi.advanceTimersByTimeAsync(8_000);
    const out = await result;
    expect(out.kind).toBe("done");
    if (out.kind === "done") {
      expect(out.mimeType).toBe("video/mp4");
      expect(out.blob.type).toBe("video/mp4");
      expect(out.blob.size).toBe(3);
    }
    expect(seen.at(-1)?.phase).toBe("finishing");
    expect(seen.at(-1)?.elapsedMs).toBe(15_000);
    expect(FakeRecorder.last?.options).toMatchObject({ mimeType: "video/mp4" });
  });

  it("no para antes de tiempo ni sigue informando tras parar", async () => {
    const seen: ClipProgress[] = [];
    const rec = createClipRecorder({ stream, Recorder: Ctor, onProgress: (p) => seen.push(p) });
    const result = rec.start();
    await vi.advanceTimersByTimeAsync(14_900);
    expect(FakeRecorder.last?.state).toBe("recording");
    await vi.advanceTimersByTimeAsync(100);
    await result;
    const n = seen.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(seen).toHaveLength(n);
  });

  it("cancelar descarta los datos", async () => {
    const rec = createClipRecorder({ stream, Recorder: Ctor });
    const result = rec.start();
    await vi.advanceTimersByTimeAsync(3_000);
    rec.cancel();
    expect(await result).toEqual({ kind: "cancelled" });
    await vi.advanceTimersByTimeAsync(20_000); // el temporizador de 15 s no vuelve a disparar nada
  });

  it("sin mimeType soportado → unsupported", async () => {
    FakeRecorder.supported = new Set();
    await expect(createClipRecorder({ stream, Recorder: Ctor }).start()).rejects.toThrow(
      "unsupported",
    );
  });

  it("usa webm si mp4 no está", async () => {
    FakeRecorder.supported = new Set(["video/webm"]);
    const rec = createClipRecorder({ stream, Recorder: Ctor, durationMs: 1_000 });
    const result = rec.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toMatchObject({ kind: "done", mimeType: "video/webm" });
  });

  it("error del grabador → recorder; si no cierra tras parar → stalled", async () => {
    const rec = createClipRecorder({ stream, Recorder: Ctor });
    const failed = rec.start();
    const failure = expect(failed).rejects.toThrow("recorder");
    FakeRecorder.last?.onerror?.(new Error("x"));
    await failure;

    const stuck = createClipRecorder({ stream, Recorder: Ctor, durationMs: 1_000 });
    const result = stuck.start();
    const stalled = expect(result).rejects.toThrow("stalled");
    (FakeRecorder.last as FakeRecorder).stuck = true;
    await vi.advanceTimersByTimeAsync(1_000 + STOP_GRACE_MS);
    await stalled;
  });
});
