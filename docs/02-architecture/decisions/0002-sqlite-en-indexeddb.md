---
title: "ADR 0002: SQLite (sql.js) persistido en IndexedDB"
owner: pendiente-de-confirmar
status: accepted
last_reviewed: 2026-10-10
review_every_days: 365
sources:
  - utils/links-db.ts
---

# ADR 0002: SQLite en memoria persistido en IndexedDB

Estado: aceptada. **Reconstruida a partir del código; confirmar con el equipo.**

## Decisión
Usar sql.js (SQLite compilado a WASM) y guardar el archivo completo en IndexedDB después de cada cambio.

## Razones visibles en el código
- Permite **exportar/importar archivos `.sqlite/.db` reales** entre navegadores y perfiles.
- Sobrevive a reinicios del service worker.

## Consecuencias
- Cada escritura serializa toda la base (`db.export()`); el coste crece con el tamaño.
- Requiere `wasm-unsafe-eval` en la CSP.
- Una cola serializa las operaciones porque el background recibe mensajes en paralelo.
- Sin versionado de esquema: migraciones por inspección de columnas.
