---
title: Dependencia sql.js
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - package.json
  - utils/links-db.ts
---

# sql.js

SQLite compilado a WebAssembly. Versión resuelta `1.14.2` (rango `^1.14.2`), tipos `@types/sql.js 1.4.11`. Licencia MIT (leída de `node_modules`, 2026-10-10).

- **Para qué**: base de datos local de links con importación/exportación de archivos SQLite ([base de datos](../07-data/database.md)).
- **Dónde**: solo `utils/links-db.ts` (aislada en ese módulo).
- **Integración**: el `.wasm` se importa con `?url` (`sql.js/dist/sql-wasm-browser.wasm`), se descarga con `fetch` y se pasa como `wasmBinary` a `initSqlJs`. Requiere `wasm-unsafe-eval` en la CSP.
- **Riesgo**: la base completa vive en memoria del service worker y se re-serializa en cada guardado.
- Alternativas: ver [ADR 0002](../02-architecture/decisions/0002-sqlite-en-indexeddb.md).
