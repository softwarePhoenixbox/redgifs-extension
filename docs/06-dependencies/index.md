---
title: Índice de dependencias
owner: pendiente-de-confirmar
status: generated
sources:
  - package.json
  - pnpm-lock.yaml
---

> GENERADO por `scripts/docs/gen-deps.mjs`. No editar a mano: ejecuta `node scripts/docs/gen-deps.mjs`.

Rango declarado (package.json) frente a versión resuelta (pnpm-lock.yaml). La columna «Uso» busca imports en el código fuente y es aproximada. «n/d» = no instalado en el momento de generar (ejecuta `pnpm install` antes).

| Paquete | Tipo | Rango declarado | Versión resuelta | Licencia | Uso |
| --- | --- | --- | --- | --- | --- |
| `@ffmpeg/core` | prod | `0.12.10` | `0.12.10` | GPL-2.0-or-later | — (sin import directo) |
| `@ffmpeg/ffmpeg` | prod | `^0.12.15` | `0.12.15` | MIT | — (sin import directo) |
| `@ffmpeg/util` | prod | `^0.12.2` | `0.12.2` | MIT | — (sin import directo) |
| `fflate` | prod | `^0.8.3` | `0.8.3` | MIT | `premium/exporters.ts` |
| `react` | prod | `^19.3.0` | `19.3.0` | MIT | `entrypoints/popup/App.tsx`, `entrypoints/popup/main.tsx` |
| `react-dom` | prod | `^19.3.0` | `19.3.0` | MIT | `entrypoints/popup/main.tsx` |
| `sql.js` | prod | `^1.14.2` | `1.14.2` | MIT | `utils/links-db.ts` |
| `@types/react` | dev | `^19.3.0` | `19.3.0` | MIT | herramienta de build/tipos |
| `@types/react-dom` | dev | `^19.3.0` | `19.3.0` | MIT | herramienta de build/tipos |
| `@types/sql.js` | dev | `^1.4.11` | `1.4.11` | MIT | herramienta de build/tipos |
| `@wxt-dev/auto-icons` | dev | `^1.1.2` | `1.1.2` | MIT | herramienta de build/tipos |
| `@wxt-dev/module-react` | dev | `^1.2.2` | `1.2.2` | MIT | herramienta de build/tipos |
| `sharp` | dev | `^0.35.4` | `0.35.4` | Apache-2.0 | herramienta de build/tipos |
| `typescript` | dev | `^7.0.2` | `7.0.2` | Apache-2.0 | herramienta de build/tipos |
| `web-ext` | dev | `^10.6.0` | `10.6.0` | MPL-2.0 | herramienta de build/tipos |
| `wxt` | dev | `^0.21.4` | `0.21.4` | MIT | herramienta de build/tipos |

Total: 16 dependencias directas (7 de producción).
