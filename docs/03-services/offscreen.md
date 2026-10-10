---
title: Documento offscreen
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 180
sources:
  - entrypoints/offscreen/main.ts
  - entrypoints/background.ts
  - wxt.config.ts
---

# Offscreen (solo Chrome MV3)

Un service worker MV3 no tiene `URL.createObjectURL`. El background crea un documento oculto (`offscreen.html`, razón `BLOBS`) que prepara las Blob URLs.

| Mensaje | Qué hace | Edición |
| --- | --- | --- |
| `RG_OFFSCREEN_PREPARE_BLOB` | `fetch` del MP4, `embedMp4Metadata`, devuelve `blob_url` (`video/mp4`) | todas |
| `RG_OFFSCREEN_PREPARE_IMAGE_BLOB` | Decodifica base64 y devuelve `blob_url` (`image/jpeg`) | solo `HAS_PREMIUM` |
| `RG_OFFSCREEN_REVOKE_BLOB` | `URL.revokeObjectURL` | todas |

Regla importante (documentada en el código y en `GUIA_PROBLEMAS_EXTENSIONES_WEBEXT.md` §2): `runtime.sendMessage` se difunde a todas las páginas de la extensión, así que el offscreen **ignora de forma síncrona** los mensajes que no son suyos para no competir con el listener del background.

El permiso `offscreen` se añade solo en el build de Chrome mediante el hook `build:manifestGenerated` de `wxt.config.ts` (verificado: aparece en `chrome-mv3-*`, no en `firefox-mv2-basic`).
