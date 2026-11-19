import { WsMessageSchema, type WsMessage } from "@pulso/schema";

export type ParseResult = { ok: true; message: WsMessage } | { ok: false; reason: string };

/** Valida un mensaje crudo del WebSocket con los esquemas de @pulso/schema. Nunca lanza. */
export function parseWsMessage(raw: unknown): ParseResult {
  if (typeof raw !== "string") return { ok: false, reason: "mensaje no textual" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "JSON inválido" };
  }
  const result = WsMessageSchema.safeParse(json);
  if (!result.success) return { ok: false, reason: result.error.issues[0]?.message ?? "inválido" };
  return { ok: true, message: result.data };
}
