/** Trama WebSocket de texto servidor → cliente (RFC 6455, sin máscara, un único fragmento). */
export function encodeTextFrame(text: string): Uint8Array {
  const payload = new TextEncoder().encode(text);
  const len = payload.length;
  let header: number[];
  if (len < 126) header = [0x81, len];
  else if (len < 65536) header = [0x81, 126, (len >> 8) & 0xff, len & 0xff];
  else {
    const hi = Math.floor(len / 2 ** 32);
    const lo = len >>> 0;
    header = [
      0x81,
      127,
      (hi >> 24) & 0xff,
      (hi >> 16) & 0xff,
      (hi >> 8) & 0xff,
      hi & 0xff,
      (lo >>> 24) & 0xff,
      (lo >>> 16) & 0xff,
      (lo >>> 8) & 0xff,
      lo & 0xff,
    ];
  }
  const out = new Uint8Array(header.length + len);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

/** Tramas de control mínimas. */
export const PONG_FRAME = new Uint8Array([0x8a, 0x00]);
export const CLOSE_FRAME = new Uint8Array([0x88, 0x00]);

/** Opcode de la primera trama que envía el cliente (0x8 cierre, 0x9 ping). */
export function frameOpcode(chunk: Uint8Array): number {
  return (chunk[0] ?? 0) & 0x0f;
}
