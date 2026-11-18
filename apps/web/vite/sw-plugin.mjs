// Plugin mínimo: tras el build, empaqueta src/pwa/sw.ts a dist/sw.js con la lista de precaché
// (todo lo emitido salvo mapas y teselas) y una versión derivada del contenido.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { build } from "vite";

const EXCLUDED = (rel) =>
  rel === "sw.js" || rel === "index.html" || rel.endsWith(".map") || rel.startsWith("tiles/");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

export function swPlugin() {
  let root = "";
  let outDir = "";
  return {
    name: "pulso-sw",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const files = walk(outDir)
        .map((f) => relative(outDir, f).split(sep).join("/"))
        .filter((rel) => !EXCLUDED(rel))
        .sort();
      const hash = createHash("sha1");
      for (const rel of ["index.html", ...files]) {
        hash.update(rel).update(readFileSync(join(outDir, rel)));
      }
      const version = hash.digest("hex").slice(0, 10);
      const precache = ["./", ...files.map((f) => `./${f}`)];
      await build({
        configFile: false,
        root,
        publicDir: false,
        logLevel: "warn",
        define: { __SW_VERSION__: JSON.stringify(version), __PRECACHE__: JSON.stringify(precache) },
        build: {
          target: "es2022",
          outDir,
          emptyOutDir: false,
          minify: true,
          sourcemap: false,
          lib: {
            entry: resolve(root, "src/pwa/sw.ts"),
            formats: ["iife"],
            name: "pulsoSw",
            fileName: () => "sw.js",
          },
        },
      });
    },
  };
}
