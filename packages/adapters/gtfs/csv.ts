/** CSV de GTFS (RFC 4180): comillas, comillas dobles escapadas, saltos CRLF/LF y BOM. Puro. */

/** Itera filas como arrays de campos; salta líneas en blanco. */
export function* csvRows(text: string): Generator<string[]> {
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < n) {
    const row: string[] = [];
    for (;;) {
      let field: string;
      if (text.charCodeAt(i) === 34) {
        i++;
        field = "";
        for (;;) {
          const q = text.indexOf('"', i);
          if (q === -1) {
            field += text.slice(i);
            i = n;
            break;
          }
          field += text.slice(i, q);
          if (text.charCodeAt(q + 1) === 34) {
            field += '"';
            i = q + 2;
          } else {
            i = q + 1;
            break;
          }
        }
        // Basura tras la comilla de cierre hasta el separador.
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === 44 || c === 10 || c === 13) break;
          i++;
        }
      } else {
        let j = i;
        while (j < n) {
          const c = text.charCodeAt(j);
          if (c === 44 || c === 10 || c === 13) break;
          j++;
        }
        field = text.slice(i, j);
        i = j;
      }
      row.push(field);
      if (text.charCodeAt(i) === 44) {
        i++;
        continue;
      }
      if (text.charCodeAt(i) === 13) i++;
      if (text.charCodeAt(i) === 10) i++;
      break;
    }
    if (row.length === 1 && row[0] === "") continue;
    yield row;
  }
}

export type CsvRecord = Readonly<Record<string, string | undefined>>;

/** Itera registros columna → valor según la cabecera. Las columnas ausentes valen `undefined`. */
export function* csvRecords(text: string): Generator<CsvRecord> {
  let header: string[] | null = null;
  for (const row of csvRows(text)) {
    if (!header) {
      header = row.map((h) => h.trim());
      continue;
    }
    const rec: Record<string, string> = {};
    for (let k = 0; k < header.length; k++) {
      const key = header[k];
      const value = row[k];
      if (key && value !== undefined) rec[key] = value;
    }
    yield rec;
  }
}
