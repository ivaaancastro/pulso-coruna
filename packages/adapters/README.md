# packages/adapters

Un adaptador por fuente en `packages/adapters/<fuente>/` (`index.ts`, `fixtures/`, `index.test.ts`), implementando `Adapter<T>` de `@pulso/schema`. `fetch` toca la red (usar `common/http.ts`); `parse` es puro y se testea contra fixtures grabadas, nunca contra la API real. Ver `docs/ROADMAP.md` (M3.1–M3.4, M5.1) y la skill `new-adapter`.
