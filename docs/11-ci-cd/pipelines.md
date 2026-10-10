---
title: CI/CD
owner: pendiente-de-confirmar
status: needs-review
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - release-please-config.json
  - .release-please-manifest.json
  - CHANGELOG.md
---

# CI/CD

El repo **no contiene workflows** (`.github/` ausente). Lo único presente es la configuración de `release-please`:

- `release-please-config.json`: paquete raíz, `release-type: node`, `tag-separator: "-"`.
- `.release-please-manifest.json`: `{".":"0.1.54"}`.
- `CHANGELOG.md`: enlaces a `github.com/softwarePhoenixbox/redgifs-extension` con tags `redgifs-extension-v<versión>`.

Se deduce que release-please corre en GitHub, pero el workflow no está en este archivo comprimido ([pendiente 7](../README.md#pendiente-de-confirmar)). Compilación y empaquetado manual: [puesta en marcha](../01-getting-started/local-setup.md).

Propuesta de checks mínimos para un CI (no implementada): `pnpm install --frozen-lockfile`, `pnpm compile`, `pnpm build:all`, `pnpm exec web-ext lint --source-dir .output/firefox-mv2-basic`.
