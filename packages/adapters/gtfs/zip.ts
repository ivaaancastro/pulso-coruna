/**
 * Lector mínimo de ZIP (métodos 0 «stored» y 8 «deflate») sin dependencias: la descompresión
 * usa `DecompressionStream`, estándar web disponible en Node ≥ 18. Sin ZIP64 ni cifrado.
 */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
/** Tope de bytes descomprimidos por archivo: protege de zips-bomba (el mayor del feed real pesa ~13 MB). */
export const MAX_ENTRY_BYTES = 128 * 1024 * 1024;

export interface UnzipOptions {
  /** Solo se descomprimen los nombres que cumplan el filtro; por defecto, todos. */
  filter?: (name: string) => boolean;
}

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.length !== expected) throw new Error("ZIP: tamaño descomprimido inesperado");
  return out;
}

/** Devuelve nombre → bytes de cada entrada (no carpetas). Lanza ante un zip corrupto o no soportado. */
export async function unzip(
  bytes: Uint8Array,
  { filter = () => true }: UnzipOptions = {},
): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP: no se encontró el directorio central");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new Error("ZIP64 no soportado");

  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CEN_SIG) {
      throw new Error("ZIP: directorio central corrupto");
    }
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/") || !filter(name)) continue;
    if (flags & 1) throw new Error(`ZIP: «${name}» está cifrado`);
    if (size > MAX_ENTRY_BYTES) throw new Error(`ZIP: «${name}» supera el tamaño máximo`);
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOC_SIG) {
      throw new Error(`ZIP: cabecera local corrupta en «${name}»`);
    }
    const start =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    const data = bytes.subarray(start, start + compSize);
    if (data.length !== compSize) throw new Error(`ZIP: «${name}» truncado`);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflateRaw(data, size));
    else throw new Error(`ZIP: método de compresión ${method} no soportado`);
  }
  return out;
}
