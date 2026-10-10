---
title: Content script de Reddit
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - entrypoints/reddit.content.ts
  - entrypoints/background.ts
---

# Content script de Reddit (`entrypoints/reddit.content.ts`)

Corre en `*://reddit.com/*` y `*://*.reddit.com/*` (solo el frame principal). Su función real hoy es **dibujar el menú de calidad** (HD/SD/Imagen/Fotograma) fuera del iframe del embed de RedGifs, porque el iframe es demasiado pequeño.

## Flujo del menú

```mermaid
sequenceDiagram
  participant I as content.ts (iframe /ifr/id)
  participant B as Background
  participant R as reddit.content.ts (frame 0)
  I->>B: RG_REDDIT_MENU_OPEN {requestId,gifId,choices}
  B->>B: guarda {tabId, frameId} del iframe
  B->>R: RG_REDDIT_MENU_SHOW (frameId 0)
  R->>R: dibuja menú junto al iframe
  R->>B: RG_REDDIT_MENU_SELECTED {requestId,choice}
  B->>I: RG_REDDIT_MENU_CHOOSE (frameId del iframe)
  I->>B: RG_DOWNLOAD …
```

El background rechaza `OPEN` si el emisor es el frame 0, y `SELECTED` si no viene del frame 0 de la misma pestaña (`pendingRedditMenuTargets`).

## Código heredado

`scan()` hoy **solo elimina** paneles antiguos (`.rg-reddit-download-tools`); la inyección de botones propia de Reddit (`installOn`, `showQualityMenu`, `createDownloadButton`) existe pero ya no se invoca. Comentario del código: las descargas se inyectan ahora desde el content script dentro del frame `/ifr/<id>`. Candidato a limpieza.

## Ajustes que lee

`rgLanguage`, `rgDownloadQuality`, `rgPremium` ([catálogo](../catalogs/storage-keys.md)).
