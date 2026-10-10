---
title: Módulo premium (`premium/` y `stubs/`)
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - utils/premium-api.ts
  - premium/index.ts
  - premium/exporters.ts
  - stubs/premium.ts
  - wxt.config.ts
---

# Módulo premium

Contrato `PremiumApi` (`utils/premium-api.ts`) con dos implementaciones intercambiables mediante el alias `@premium`.

| Método | Qué hace | Implementación |
| --- | --- | --- |
| `exportLinks(format, language)` | Genera `redgifs-links.{sqlite,db,xlsx,html}` en base64 | `premium/index.ts` + `premium/exporters.ts` |
| `saveBulk(links, deps)` | Valida y guarda varios links (`saveLink` en serie) | `premium/index.ts` |
| `downloadAll(deps)` | Descarga todo lo guardado; cuenta `queued/failed/withoutMetadata` | `premium/index.ts` |

`PremiumDeps` inyecta `isRedgifsUrl`, `idPattern` y `startVideoDownload` desde el background (la lógica premium no duplica validaciones).

- `stubs/premium.ts`: las tres funciones lanzan «Esta función no está incluida en la edición básica».
- Exportadores: XLSX construido a mano con `fflate` (`zipSync`) y HTML autocontenido (`buildHtml`, descarga imágenes; su JS interno escribe el atom Xtra). El exportador usa `safeHttpsUrl` para aceptar solo URLs `https`.

Cómo se elige: `wxt.config.ts` → `alias: { '@premium': cliMode() === 'basic' ? 'stubs/premium' : 'premium' }`. Ver [ADR 0001](../02-architecture/decisions/0001-ediciones-de-build.md).
