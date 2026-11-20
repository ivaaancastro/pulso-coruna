export class PulseFetchError extends Error {
  constructor(
    message: string,
    /** `nodata`: la API rechaza la ventana (p. ej. fuera de la retención); `error`: red/servidor/contrato. */
    readonly kind: "error" | "nodata",
  ) {
    super(message);
    this.name = "PulseFetchError";
  }
}
