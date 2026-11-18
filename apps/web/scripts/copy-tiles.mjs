// Copia infra/tiles/.work/coruna.pmtiles (lo genera infra/tiles/build.sh) a public/tiles/.
// El .pmtiles no se versiona. Uso: pnpm --filter @pulso/web tiles:copy [ruta/al/coruna.pmtiles]
/* global process, console */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.argv[2] ?? join(here, "../../../infra/tiles/.work/coruna.pmtiles"));
const target = join(here, "../public/tiles/coruna.pmtiles");

if (!existsSync(source)) {
  console.error(
    `No existe ${source}.\nGenéralo con: infra/tiles/build.sh (ver infra/tiles/README.md)`,
  );
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`Copiado ${(statSync(target).size / 1e6).toFixed(2)} MB -> ${target}`);
