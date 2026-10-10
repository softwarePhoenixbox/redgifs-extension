---
title: Protocolo de mensajes internos
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 60
sources:
  - utils/messages.ts
  - entrypoints/background.ts
  - entrypoints/offscreen/main.ts
---

# Protocolo de mensajes (`RgRequest` / `RgResponse`)

Contrato entre content scripts, popup, background y offscreen. Tipos en `utils/messages.ts`. Toda respuesta es `{ ok: true, … }` o `{ ok: false, error }`. Los mensajes inválidos terminan en `Mensaje desconocido`.

## Hacia el background

| Tipo | Emisor | Campos clave | Respuesta (`ok:true`) | Plan |
| --- | --- | --- | --- | --- |
| `RG_RESOLVE_GIF` | content | `id` | `gif{videoUrl,hdVideoUrl,sdVideoUrl,imageUrl,metadata}` o `not_found`/`rate_limited` | libre |
| `RG_DOWNLOAD` | content, Reddit | `id,url,quality?,title?,author?,tags?,pageUrl?,filename?,useOriginalFilename?` | `downloadId,metadata_embedded,metadata_warning` | `sd` libre; resto premium |
| `RG_DOWNLOAD_FRAME` | content | `id,base64,filename?,useOriginalFilename?` | `downloadId` | premium |
| `RG_SAVE_LINK` | content | `id,url,imageUrl?,pageUrl,title?,author?,tags?,views?,likes?` | `inserted,total` | libre |
| `RG_SAVE_BULK` | content | `links: BulkLinkInput[]` | `inserted_count,updated_count,total` | premium |
| `RG_STATS` | content, popup | — | `total` | libre |
| `RG_CHECK_LINK` | content | `id` | `exists` | libre |
| `RG_LIST_LINKS` | popup | — | `links: LinkRow[]` | libre |
| `RG_DELETE_LINK` | popup | `id` | `total` | libre |
| `RG_IMPORT_DB` | popup, content | `base64` | `imported,updated,total` | libre |
| `RG_EXPORT_DB` | popup, content | `format: sqlite\|db\|xlsx\|html`, `language?` | `base64,filename,mime` | premium |
| `RG_DOWNLOAD_ALL` | popup | — | `queued,failed,without_metadata` | premium |
| `RG_LICENSE_GET` | popup | `refresh?` | `license` | libre |
| `RG_LICENSE_ACTIVATE` | popup | `key` | `license` | libre |
| `RG_LICENSE_RELEASE` | popup | — | `license` | libre |
| `RG_REDDIT_MENU_OPEN` | content (iframe) | `requestId,gifId,choices` | — | libre |
| `RG_REDDIT_MENU_SELECTED` | Reddit (frame 0) | `requestId,choice` | — | libre |

## Hacia content scripts

| Tipo | De → a | Uso |
| --- | --- | --- |
| `RG_REDDIT_MENU_SHOW` | background → Reddit (frame 0) | Dibuja el menú |
| `RG_REDDIT_MENU_CHOOSE` | background → iframe origen | Devuelve la opción elegida |
| `RG_TOGGLE_GRID_SELECT` | popup → pestaña activa | Activa/desactiva selección múltiple |
| `RG_GET_GRID_SELECT_STATE` | popup → pestaña activa | `enabled, selected_count, pending_count, saved_count` |
| `RG_LIST_GRID_SELECTION` | popup → pestaña activa | `selection: {id,title,saved}[]` |
| `RG_DESELECT_GRID_ITEM` | popup → pestaña activa | Destilda un item |

## Hacia el offscreen

`RG_OFFSCREEN_PREPARE_BLOB`, `RG_OFFSCREEN_PREPARE_IMAGE_BLOB`, `RG_OFFSCREEN_REVOKE_BLOB` — ver [offscreen](../03-services/offscreen.md).

## Cómo añadir un mensaje

1. Añadir la variante a `RgRequest` (y campos a `RgResponse`).
2. Implementar el `case` en `handle()` del background, con validación de entrada.
3. Si es premium: `if (!HAS_PREMIUM) throw …; await requirePremium();` y poner la lógica en `premium/` + firma en `utils/premium-api.ts` + stub en `stubs/premium.ts`.
4. Actualizar esta tabla.

Regla heredada de `GUIA_PROBLEMAS_EXTENSIONES_WEBEXT.md`: cada listener debe ignorar de forma síncrona los mensajes que no son suyos y devolver `true` solo cuando va a responder después.
