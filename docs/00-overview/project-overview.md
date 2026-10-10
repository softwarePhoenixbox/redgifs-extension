---
title: Visión general de RedGifs Extension
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - package.json
  - wxt.config.ts
  - entrypoints/content.ts
  - entrypoints/background.ts
  - utils/download-options.ts
---

# Visión general

RedGifs Extension es una extensión de navegador que, sobre las páginas de `redgifs.com` y de los embeds de RedGifs dentro de `reddit.com`, permite **descargar los videos con metadatos incrustados** y **guardar enlaces en una base SQLite local**. Es para usuarios finales de esos sitios; este documento es para quien la mantiene.

## Qué hace

- **Descargar el video** del GIF activo (feed, `/watch/<id>`, perfiles, embeds `/ifr/<id>` en Reddit). Descarga el MP4 y le inserta metadatos (título, autor, tags, URL de la página) sin recodificar. Fuente: `entrypoints/background.ts` (`startVideoDownload`), `utils/mp4-metadata.ts`.
- **Guardar enlaces** (id, URL del video, imagen, página, título, autor, tags, vistas, likes) en una base SQLite que vive en el navegador (sql.js + IndexedDB). Opción de **auto-guardado** con umbral de vistas. Fuente: `utils/links-db.ts`, `entrypoints/content.ts`.
- **Popup** para ver, buscar y borrar los links guardados, importar una base `.sqlite/.db` (fusión sin duplicados), ajustes e interfaz de licencia. Fuente: `entrypoints/popup/App.tsx`.
- **Panel flotante** «On-screen video» (opcional) con el detalle del video activo.
- Interfaz en inglés y español (`utils/popup-i18n.ts`).

## Planes y ediciones

Hay un plan gratuito y uno premium. Se materializan en tres ediciones de build; el detalle está en [Ediciones y licencias](../13-security/editions-and-licensing.md).

| Función | Gratis (`basic`) | Premium |
| --- | --- | --- |
| Descargar video SD con metadatos | Sí | Sí |
| Descargar HD, imagen JPG, captura de fotograma | No | Sí |
| Guardar link, listar, borrar, importar DB | Sí | Sí |
| Exportar (sqlite, db, xlsx, html) | No | Sí |
| «Descargar todo» lo guardado | No | Sí |
| Selección múltiple en grillas y guardado en lote | No | Sí |

Fuente: `utils/download-options.ts`, `entrypoints/background.ts` (`handle`), `LEEME-v3.txt`.

## Estado

Versión `0.1.54` (`package.json`, `wxt.config.ts`, `.release-please-manifest.json`). Último cambio registrado en `CHANGELOG.md`: 2026-09-25. Licencia del código: MIT (`LICENSE`).

## Alcance y límites

- Solo opera en `*.redgifs.com` y `*.reddit.com` (`host_permissions` en `wxt.config.ts`).
- Los selectores del DOM de RedGifs/Reddit son frágiles: si los sitios cambian su marcado, hay que ajustarlos (ver [content script RedGifs](../03-services/content-redgifs.md)).
- Las URLs de media de RedGifs pueden vencer; «Descargar todo» puede fallar para links viejos (`premium/index.ts`, comentario en `downloadAll`).
