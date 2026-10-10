---
title: Versionado y releases
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - package.json
  - wxt.config.ts
  - release-please-config.json
  - .release-please-manifest.json
  - CHANGELOG.md
---

# Versionado y releases

- Versionado semántico gestionado por **release-please** (`release-type: node`), a partir de Conventional Commits (`fix:`, `feat:`…). Ejemplo en `CHANGELOG.md`: «Bug Fixes — trigger release for extension fixes».
- La versión aparece en **tres sitios** que deben coincidir: `package.json` (`version`), `.release-please-manifest.json` y **`wxt.config.ts`** (`manifest.version`, escrita a mano como `'0.1.54'`). release-please actualiza los dos primeros; el tercero no se actualiza solo, así que hay que mantenerlo sincronizado. Es un riesgo de desfase (hallazgo, 2026-10-10).
- Empaquetado: `pnpm zip:basic`, `pnpm zip:premium`, `pnpm zip:firefox` (`wxt zip`). Nota: no hay script `zip` para `activated` a propósito.
- Convención recomendada: los commits `docs:` no generan release (con release-please por defecto, `docs` no sube versión).
- Antes de publicar: comprobar `LICENSE_SITE` y `LICENSE_PUBLIC_JWK` en `utils/license-config.ts` y que el paquete `basic` no contenga código premium.

Publicación en tiendas: no consta en el repo ([pendiente 9](../README.md#pendiente-de-confirmar)).
