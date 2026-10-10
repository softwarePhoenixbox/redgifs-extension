---
title: Popup (React)
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - entrypoints/popup/App.tsx
  - entrypoints/popup/main.tsx
  - utils/popup-i18n.ts
---

# Popup

Interfaz React 19 (`entrypoints/popup/App.tsx`, 749 líneas) que se abre desde el icono de la extensión (`action.default_title`: «RG Scroller — Links guardados»).

## Funciones

- Lista de links guardados (`RG_LIST_LINKS`), búsqueda por título/autor/tag, borrar (`RG_DELETE_LINK`), refrescar.
- **Importar** DB `.sqlite/.db` con fusión sin duplicados (`RG_IMPORT_DB`).
- **Premium**: exportar `sqlite|db|xlsx|html` (`RG_EXPORT_DB`), «Descargar todo» (`RG_DOWNLOAD_ALL`), selección múltiple en la página (`RG_TOGGLE_GRID_SELECT` y compañía, enviados a la pestaña activa).
- **Ajustes**: panel on-screen, icono de descarga, opciones de descarga (`hd`, `sd`, `image`, `frame`), nombre original de archivo, idioma (en/es).
- **Licencia**: ver estado, copiar el `installId`, activar con clave (`RG_LICENSE_ACTIVATE`), refrescar (`RG_LICENSE_GET`), liberar cupo (`RG_LICENSE_RELEASE`).

## Notas de diseño

- Su estado de React se reinicia cada vez que se cierra, por eso al abrir vuelve a consultar al content script (`RG_GET_GRID_SELECT_STATE`), que es la fuente de verdad del modo selección.
- La interfaz de licencia se muestra según la edición (`licensedEdition`).
- Textos en `utils/popup-i18n.ts` (en/es), compartidos con los content scripts y los exportadores.

Interactúa con: [background](background.md) y [content-redgifs](content-redgifs.md). Mensajes: [protocolo](../04-apis/messages.md).
