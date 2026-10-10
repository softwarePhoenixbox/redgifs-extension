---
title: Permisos del manifiesto
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - wxt.config.ts
  - (manifest generado en .output/*/manifest.json)
---

# Permisos

Valores verificados el 2026-10-10 en los manifiestos generados por `pnpm build:*`.

| Permiso | Edición | Justificación (deducida del código; confirmar) |
| --- | --- | --- |
| `storage` | todas | Ajustes, `installId` y token de licencia (`storage.local`) |
| `downloads` | todas | `downloads.download` para videos e imágenes |
| `activeTab` | todas | El popup consulta/controla la pestaña activa (selección en grilla) |
| `offscreen` | solo Chrome | Crear Blob URLs en MV3 ([offscreen](../03-services/offscreen.md)) |
| `https://api.redgifs.com/*` | todas | Token y datos del GIF |
| `https://media.redgifs.com/*` | todas | Descargar MP4/JPG y leerlos para incrustar metadatos |
| `https://reddit.com/*`, `https://*.reddit.com/*` | todas | Content script de Reddit |
| `https://redgifs-license.pages.dev/*` | solo `premium` | Servidor de licencias |
| Content script `*://*.redgifs.com/*` (`all_frames`) | todas | UI y scraping en RedGifs y sus embeds |

CSP de páginas de la extensión: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';` (necesaria para WASM de sql.js).

Firefox declara `data_collection_permissions`: `none` en `basic` y `activated`; `technicalAndInteraction` en `premium` (envía el `installId` aleatorio).

Nota: los patrones `*://*.redgifs.com/*` y `*://*.reddit.com/*` de los content scripts se declaran en `content_scripts.matches`; en `host_permissions` solo figuran `api.redgifs.com`, `media.redgifs.com` y Reddit.
