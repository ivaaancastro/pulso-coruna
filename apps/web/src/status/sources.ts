/**
 * Catálogo de fuentes con su atribución y licencia (M8.4). Es DATOS, no interfaz: los nombres y las
 * fórmulas de atribución son literales transcritos de `docs/sources/<fuente>.md` y no se traducen.
 * No se inventa ningún término: lo que la nota no documenta queda con `license: null`.
 * Las licencias y atribuciones son decisión humana; al cerrar una, se edita aquí.
 */
export interface LicenseInfo {
  name: string;
  url: string;
  /** La fuente declara esta licencia pero su texto no se ha podido leer: se muestra como pendiente. */
  unverified?: true;
}

export interface SourceInfo {
  /** Clave interna estable (no es el id de `source_health`). */
  key: string;
  name: string;
  /** Texto de atribución requerido o acordado. */
  attribution: string;
  /** Web de la fuente (enlace de la atribución). */
  url: string;
  /** `null` = sin licencia localizada: se muestra «pendiente de confirmar». */
  license: LicenseInfo | null;
  /** Hay una condición de uso que mostrar (`credits.note.<key>`). Para qué se usa la fuente: `credits.use.<key>`. */
  note?: true;
  /**
   * Ids de `source_health` que alimentan esta fuente (`/api/v1/health` → `sources[].id`).
   * Vacío = dato estático (teselas propias): no tiene estado en vivo.
   */
  healthIds: readonly string[];
}

export const SOURCES: readonly SourceInfo[] = [
  {
    key: "bicicoruna",
    name: "BiciCoruña",
    attribution: "Concello da Coruña · BiciCoruña (datos.coruna.gal)",
    url: "https://datos.coruna.gal/",
    // Catálogo CKAN: «RISP_AC»; el texto del aviso legal no se pudo leer (docs/sources/bicicoruna.md).
    license: {
      unverified: true,
      name: "RISP_AC",
      url: "https://www.coruna.gal/opendata/avisolegal",
    },
    healthIds: ["bicicoruna"],
  },
  {
    key: "tranvias-gtfs",
    name: "Tranvías A Coruña (GTFS)",
    attribution:
      "La Coruña Tram Company SA, Raw data from the Spanish National Access Point, powered by MIMTRANS",
    url: "https://mobilitydatabase.org/feeds/gtfs/mdb-2767",
    license: null,
    healthIds: ["bus-schedule", "gtfs-tranvias"],
  },
  {
    key: "itranvias",
    name: "iTranvías",
    attribution: "Compañía de Tranvías de La Coruña (iTranvías)",
    url: "https://itranvias.com/",
    license: null,
    healthIds: ["itranvias"],
  },
  {
    key: "meteogalicia",
    name: "MeteoGalicia",
    attribution: "Fonte dos datos: Xunta de Galicia (MeteoGalicia)",
    url: "https://abertos.xunta.gal",
    // Licencia declarada en el catálogo Abert@s (docs/sources/meteogalicia.md).
    license: {
      name: "CC BY-SA 4.0",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
    },
    healthIds: ["meteogalicia"],
  },
  {
    key: "portus",
    name: "Puertos del Estado (Portus)",
    attribution: "Puertos del Estado · Portus",
    url: "https://portus.puertos.es/",
    license: null,
    healthIds: ["portus"],
  },
  {
    key: "openmeteo-air",
    name: "Open-Meteo",
    attribution: "Open-Meteo.com (datos CAMS)",
    url: "https://open-meteo.com/",
    license: {
      name: "CC BY 4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
    },
    note: true,
    healthIds: ["openmeteo-air"],
  },
  {
    key: "aisstream",
    name: "aisstream.io",
    attribution: "aisstream.io",
    url: "https://aisstream.io/",
    license: null,
    healthIds: ["aisstream"],
  },
  {
    key: "opensky",
    name: "OpenSky Network",
    attribution: "OpenSky Network",
    url: "https://opensky-network.org/",
    license: null,
    healthIds: ["opensky"],
  },
  {
    key: "osm",
    name: "OpenStreetMap",
    attribution: "© OpenMapTiles · © OpenStreetMap contributors",
    url: "https://www.openstreetmap.org/copyright",
    license: {
      name: "ODbL",
      url: "https://www.openstreetmap.org/copyright",
    },
    healthIds: [],
  },
  {
    key: "catastro",
    name: "Catastro",
    attribution: "© Dirección General del Catastro (Ministerio de Hacienda)",
    url: "https://www.catastro.hacienda.gob.es/",
    // Licencia INSPIRE de la DG del Catastro (v1.0, 2016), aceptada por el humano (2026-11-18).
    license: {
      name: "Licencia INSPIRE DG Catastro",
      url: "https://www.catastro.hacienda.gob.es/webinspire/index.html",
    },
    note: true,
    healthIds: [],
  },
];
