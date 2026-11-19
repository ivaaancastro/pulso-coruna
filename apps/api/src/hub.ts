import { LAYER_IDS, type LayerId, type LayerItem } from "@pulso/schema";
import type { DataSource, Latest } from "./db.js";
import { diffLayer, emptyState, stateItems, type LayerState } from "./diff.js";
import { deltaMessage, snapshotMessage } from "./protocol.js";

/** Lo que el hub necesita de una conexión (el WebSocket real o un doble en los tests). */
export interface ClientSink {
  layers: ReadonlySet<LayerId>;
  send(data: string): void;
  /** Bytes pendientes de enviar; si se acumulan, el cliente va demasiado lento. */
  bufferedAmount(): number;
  /** Corta al cliente (no esperar al cierre ordenado). */
  drop(reason: string): void;
}

export interface HubOptions {
  /** Intervalo de sondeo; 0 = sin temporizador (los tests llaman a `poll()`). */
  pollMs: number;
  maxBufferedBytes: number;
  now?: () => number;
  log?: {
    warn(obj: object, msg: string): void;
    debug?(obj: object, msg: string): void;
  };
}

/**
 * Sondea la BD mientras haya clientes, calcula el diff por capa contra el último estado
 * y emite deltas. El snapshot de un cliente nuevo sale del mismo estado en memoria, en el
 * mismo turno del bucle de eventos en que se registra: no se pierde ni se repite ningún cambio.
 * Sin clientes no consulta nada y olvida el estado (ADR-0019).
 */
export class StreamHub {
  private state: Record<LayerId, LayerState> | undefined;
  private loading: Promise<void> | undefined;
  private readonly clients = new Set<ClientSink>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private polling = false;
  /** Sube cada vez que se descarta el estado: un sondeo en vuelo de una generación anterior se ignora. */
  private generation = 0;
  private readonly now: () => number;

  constructor(
    private readonly source: DataSource,
    private readonly o: HubOptions,
  ) {
    this.now = o.now ?? Date.now;
  }

  get size(): number {
    return this.clients.size;
  }

  /**
   * Registra al cliente y le envía el snapshot de sus capas. Lanza si la BD no responde y
   * aún no hay estado (el llamador cierra la conexión con un código claro).
   * Devuelve la función que lo da de baja.
   */
  async attach(client: ClientSink): Promise<() => void> {
    this.running = true;
    // Registrado antes de esperar la primera carga para que `detach` en carrera cuente.
    this.clients.add(client);
    try {
      await this.ensureState();
    } catch (e) {
      this.clients.delete(client);
      this.idleCheck();
      throw e;
    }
    // Si `stop()` o un cierre ya lo sacaron del hub mientras esperaba, no se le envía nada.
    if (!this.clients.has(client) || !this.state) return () => {};
    // (`detach` no hace falta en ese caso: ya no está registrado)
    const items = Object.fromEntries(
      LAYER_IDS.map((l) => [l, stateItems((this.state as Record<LayerId, LayerState>)[l])]),
    ) as Record<LayerId, LayerItem[]>;
    try {
      client.send(JSON.stringify(snapshotMessage(this.now(), [...client.layers], items)));
    } catch (e) {
      this.clients.delete(client);
      this.idleCheck();
      throw e;
    }
    this.schedule();
    return () => {
      this.clients.delete(client);
      this.idleCheck();
    };
  }

  private ensureState(): Promise<void> {
    if (this.state) return Promise.resolve();
    this.loading ??= this.source
      .latest(0)
      .then((latest) => {
        const state = emptyState();
        for (const l of LAYER_IDS) state[l] = diffLayer(l, new Map(), latest.layers[l]).next;
        // Si todos se fueron mientras cargaba, no se guarda: nadie lo mantendría al día.
        if (this.clients.size > 0) this.state = state;
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }

  /** Una consulta + diff + difusión. Pública para tests y para forzar un sondeo. */
  async poll(): Promise<void> {
    if (!this.state) {
      await this.ensureState();
      return;
    }
    const gen = this.generation;
    const latest = await this.source.latest(0);
    if (gen !== this.generation) return; // el estado se descartó mientras tanto
    this.apply(latest);
  }

  private apply(latest: Latest): void {
    const state = this.state;
    if (!state) return;
    for (const layer of LAYER_IDS) {
      const { upserts, removes, next } = diffLayer(layer, state[layer], latest.layers[layer]);
      state[layer] = next;
      if (upserts.length === 0 && removes.length === 0) continue;
      const data = JSON.stringify(deltaMessage(latest.ts, layer, upserts, removes));
      this.broadcast(layer, data);
    }
  }

  private broadcast(layer: LayerId, data: string): void {
    for (const c of [...this.clients]) {
      if (!c.layers.has(layer)) continue;
      if (c.bufferedAmount() > this.o.maxBufferedBytes) {
        this.clients.delete(c);
        this.o.log?.warn({}, "cliente WS demasiado lento: desconectado");
        c.drop("cliente demasiado lento");
        continue;
      }
      try {
        c.send(data);
      } catch (e) {
        this.clients.delete(c);
        this.o.log?.warn({ err: String(e) }, "fallo al enviar a un cliente WS");
        c.drop("error de envío");
      }
    }
    this.idleCheck();
  }

  private schedule(): void {
    if (this.o.pollMs <= 0 || this.timer || this.polling || !this.running) return;
    const tick = (): void => {
      this.timer = undefined;
      if (!this.running) return;
      this.polling = true;
      this.poll()
        .catch((e: unknown) => this.o.log?.warn({ err: String(e) }, "sondeo de la BD fallido"))
        .finally(() => {
          this.polling = false;
          if (this.clients.size > 0) this.schedule();
        });
    };
    this.timer = setTimeout(tick, this.o.pollMs);
  }

  /** Sin clientes: se para el sondeo y se descarta el estado (el siguiente conectado carga uno fresco). */
  private idleCheck(): void {
    if (this.clients.size > 0) return;
    this.running = false;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.state = undefined;
  }

  stop(): void {
    this.clients.clear();
    this.idleCheck();
  }
}
