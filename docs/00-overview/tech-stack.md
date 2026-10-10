---
title: Stack tecnológico
owner: pendiente-de-confirmar
status: generated
sources:
  - package.json
  - pnpm-lock.yaml
---

> GENERADO por `scripts/docs/gen-deps.mjs`. No editar a mano: ejecuta `node scripts/docs/gen-deps.mjs`.

Versiones resueltas desde el lockfile. Fuente de cada fila entre paréntesis.

| Capa | Tecnología | Versión | Fuente |
| --- | --- | --- | --- |
| Gestor de paquetes | pnpm | `12.5.1` (campo `packageManager`) | `package.json` |
| Framework de extensiones | WXT | `0.21.4` | `pnpm-lock.yaml` |
| Bundler (transitivo de WXT) | Vite | `8.3.0` | `pnpm-lock.yaml` |
| Lenguaje | TypeScript | `7.0.2` | `pnpm-lock.yaml` |
| UI del popup | React / React DOM | `19.3.0` | `pnpm-lock.yaml` |
| Base de datos local | sql.js (SQLite en WASM) | `1.14.2` | `pnpm-lock.yaml` |
| Exportación XLSX (premium) | fflate | `0.8.3` | `pnpm-lock.yaml` |
| Iconos | @wxt-dev/auto-icons / sharp | `1.1.2` / `0.35.4` | `pnpm-lock.yaml` |
| Ejecución y lint en Firefox | web-ext | `10.6.0` | `pnpm-lock.yaml` |
| Versión de la extensión | 0.1.54 | `0.1.54` | `package.json`, `wxt.config.ts` |

Runtime de Node para compilar: no declarado en el repo (sin `engines` ni `.nvmrc`). Ver [pendientes](../README.md#pendiente-de-confirmar).
