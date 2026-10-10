---
title: Content script de RedGifs
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 60
sources:
  - entrypoints/content.ts
  - utils/download-options.ts
  - utils/popup-i18n.ts
---

# Content script de RedGifs (`entrypoints/content.ts`)

Corre en `*://*.redgifs.com/*` y en **todos los frames** (`allFrames: true`), incluidos los embeds `/ifr/<id>` dentro de Reddit. Detecta el video activo, scrapea sus metadatos, inyecta UI y envía mensajes al [background](background.md). Es el archivo más grande (1553 líneas) y el más sensible a cambios del sitio.

## Qué hace

1. **Detecta el video activo** (`getActiveItem`), en este orden: id en `/ifr/<id>`; entre los `[data-feed-item-id]` visibles ≥30 % (el último si el scroll baja, el primero si sube); `.GifPreview.GifPreview_isActive[data-feed-item-id]`; id de `/watch/<id>`.
2. **Scrapea metadatos** del DOM (`scrapeMeta`): título y hashtags de `.description .descriptionText`, autor del href `/users/<nombre>` (fallback `span.userName`), vistas `.ViewButton-Label`, likes `.LikeButton .label`. Si faltan, usa los de la API.
3. **Panel flotante** (`#rg-scroller-panel`, desactivado por defecto): detalle del video, botón «Download», «Save link», auto-guardado con umbral de vistas, export/import. Se puede mover entre 4 esquinas y minimizar.
4. **Icono de descarga** junto a las acciones del video (`paintDownloadAction`), activo por defecto (`rgDownloadActionEnabled !== false`).
5. **Selección múltiple en grillas** (solo premium): checkboxes sobre cada `[data-feed-item-id]`; el popup activa/consulta/limpia el modo por mensajes; «Save selected» resuelve cada id y envía `RG_SAVE_BULK`.
6. **Navegación SPA**: parchea `history.pushState/replaceState` y escucha `popstate`; además observa mutaciones de clase en el body.

## Resolución de GIFs

`getValidLink(id)` pide `RG_RESOLVE_GIF` al background y cachea el resultado 5 minutos (las URLs de media pueden expirar) deduplicando peticiones en curso.

URL elegida al descargar (`downloadGifChoice`): en `basic` siempre SD (`mobileVideoUrl`); en premium `hd` → URL HD, `sd` → `-mobile.mp4`, `image` → `-mobile.jpg`, `frame` → captura del `<video>` actual dibujada en un canvas y enviada como JPEG (calidad 0,94) en base64.

## Menú de calidad en Reddit

Si hay más de una opción, el iframe está embebido en Reddit y no está en pantalla completa, pide al background `RG_REDDIT_MENU_OPEN` para que el menú se dibuje en la página de Reddit (ver [content-reddit](content-reddit.md)); si falla, muestra el menú local.

## Frágil: selectores del sitio

Si deja de funcionar, revisar con el inspector: `[data-feed-item-id]`, `.GifPreview_isActive`, `.userInfo`, `.description`, `.descriptionText`, `.ViewButton-Label`, `.LikeButton .label`, `.embeddedPlayer`. El propio código lo advierte en comentarios.

## Ajustes que lee (`storage.local`)

Ver [catálogo](../catalogs/storage-keys.md): `rgAutoSave`, `rgAutoSaveMinViews`, `rgPanelPosition`, `rgPanelCollapsed`, `rgPanelEnabled`, `rgDownloadActionEnabled`, `rgDownloadQuality` (legado), `rgDownloadOptions`, `rgOriginalFilename`, `rgLanguage`, `rgPremium`. Reacciona a `storage.onChanged`.

## Limpieza

`ctx.onInvalidated` desconecta el observer, quita listeners, checkboxes, panel, barra de grilla y estilos.

## Edición básica

Todo lo premium está bajo `if (HAS_PREMIUM)`/`HAS_PREMIUM &&`; el build `basic` pesa menos (`content.js` 41,46 kB frente a 47,93 kB en `premium`, medido el 2026-10-10).
