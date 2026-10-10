---
title: Troubleshooting
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - entrypoints/background.ts
  - entrypoints/content.ts
  - utils/license.ts
  - GUIA_PROBLEMAS_EXTENSIONES_WEBEXT.md
---

# Troubleshooting

Síntomas frecuentes, causa probable (según el código) y dónde mirar. Para fallos Chrome/Firefox ya resueltos, ver también `GUIA_PROBLEMAS_EXTENSIONES_WEBEXT.md`.

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| «El video no disponible (eliminado, privado o procesándose)» | La API devolvió 404 o no hay URL `hd`/`sd` | Abrir el video en redgifs.com; reintentar luego (`resolveRedgifsGif`) |
| «RedGifs está limitando las peticiones» | HTTP 429 de `api.redgifs.com` | Esperar unos segundos |
| «No se pudo conectar con la API de RedGifs. Revisa tu conexión o VPN.» | Fallo de red al pedir token o gif | Revisar conexión/VPN; consola del background |
| «The extension could not be reached. Reload the page.» | El content script quedó huérfano tras recargar la extensión | Recargar la pestaña |
| Descarga sin metadatos («descargó sin metadatos») | Falló la inyección MP4, formato no `mp4/m4v`, o no se detectaron metadatos | Ver el `metadata_warning` y la consola del background |
| Botón de descarga ausente en videos nuevos tras hacer scroll | Cambió el DOM de RedGifs | Revisar selectores en `content.ts` (`[data-feed-item-id]`, `.GifPreview…`) |
| «Función premium: abre el popup…» | Edición `premium` sin token válido | Activar la licencia en el popup |
| «Ya no quedan usos premium en esta licencia.» | Licencia con usos y `remaining = 0` | Ampliar usos en el servidor |
| «No se pudo contactar al servidor de licencias» | Licencia con usos exige conexión para cada acción premium | Revisar red; `redgifs-license.pages.dev` |
| `bad_signature` al activar | La clave pública de `utils/license-config.ts` no corresponde a la privada del servidor | Regenerar par de claves o corregir `LICENSE_PUBLIC_JWK` |
| «Not available in the basic edition» | Se llamó una función premium en `basic` | Esperado; usar otra edición |

Dónde ver logs: consola del service worker (Chrome → `chrome://extensions` → «service worker») o del background de Firefox (`about:debugging` → «Inspeccionar»). Los logs llevan el prefijo `[RG Scroller]`.
