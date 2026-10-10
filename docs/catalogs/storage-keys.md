---
title: Catálogo de claves de storage
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - entrypoints/content.ts
  - entrypoints/reddit.content.ts
  - entrypoints/popup/App.tsx
  - utils/license.ts
---

# Claves de `browser.storage.local`

| Clave | Tipo | Quién escribe | Descripción |
| --- | --- | --- | --- |
| `rgLanguage` | `'en'\|'es'` | popup | Idioma de la UI (por defecto `en`) |
| `rgPanelEnabled` | boolean | popup | Mostrar panel «On-screen video» (por defecto `false`) |
| `rgDownloadActionEnabled` | boolean | popup | Icono de descarga junto a las acciones (por defecto `true`) |
| `rgDownloadOptions` | `{hd,sd,image,frame}` | popup | Opciones de descarga elegidas (por defecto solo `hd`); en gratis se fuerza solo `sd` |
| `rgDownloadQuality` | `'hd'\|'sd'\|'both'` | (legado) | Formato antiguo; `normalizeDownloadOptions` lo migra |
| `rgOriginalFilename` | boolean | popup | `false` ⇒ nombre aleatorio (por defecto `true`) |
| `rgAutoSave` | boolean | content | Auto-guardado |
| `rgAutoSaveMinViews` | number | content | Umbral de vistas (0 = siempre) |
| `rgPanelPosition` | number 0–3 | content | Esquina del panel |
| `rgPanelCollapsed` | boolean | content | Panel minimizado |
| `rgPremium` | boolean | background | Bandera de **solo lectura para la UI**; no es autoridad |
| `rgInstallId` | UUID | background | Id de instalación (en `local`, no `sync`, a propósito) |
| `rgLicenseToken` | string | background | Token firmado |
| `rgLicenseStatus` | string | background | Último estado devuelto por el servidor |
| `rgLicenseCheckedAt` | ms epoch | background | Última consulta exitosa |
| `rgLicenseMeter` | `{metered,remaining}` | background | Usos restantes |

Fuente de verdad del plan: el background re-verifica el token en cada acción premium; editar `rgPremium` solo cambia lo que la UI muestra.
