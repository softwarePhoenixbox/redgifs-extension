---
title: Glosario
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 180
sources:
  - utils/license.ts
  - utils/mp4-metadata.ts
  - entrypoints/content.ts
---

# Glosario

| Término | Significado |
| --- | --- |
| Edición | Variante de build: `basic`, `premium` o `activated` (`utils/edition.ts`). |
| `HAS_PREMIUM` | Constante de compilación; `false` solo en `basic`. |
| `installId` | UUID aleatorio por instalación y perfil, guardado en `storage.local` (`rgInstallId`). Identifica la instalación ante el servidor de licencias. |
| Token de licencia | Cadena `payload.firma` firmada con ECDSA P-256 por el servidor; la extensión solo verifica con la clave pública. |
| Metered / usos | Licencia con número limitado de usos premium (`lim` en el token). |
| GIF id | Identificador de RedGifs (p. ej. `ZanyJudiciousRook`), sensible a mayúsculas en las URLs de media. |
| SD / HD | `…-mobile.mp4` (SD) frente a `….mp4` (HD) en `media.redgifs.com`. |
| Xtra / QuickTime | Dos formatos de metadatos que se insertan en el MP4 (`udta/Xtra` y `udta/meta/ilst`). |
| Offscreen document | Página oculta de Chrome MV3 usada para crear Blob URLs. |
| Grilla | Páginas de perfiles/tags con muchos thumbnails (`[data-feed-item-id]`) donde se puede seleccionar varios. |
| Embed `/ifr/<id>` | Iframe de RedGifs dentro de Reddit; el content script corre dentro de él (`allFrames: true`). |
