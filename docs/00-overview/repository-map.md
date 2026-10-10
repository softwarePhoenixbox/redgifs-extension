---
title: Mapa del repositorio
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - (árbol del repositorio)
---

# Mapa del repositorio

Un solo paquete (no es monorepo). Estructura de proyecto WXT.

| Ruta | Propósito |
| --- | --- |
| `entrypoints/background.ts` | Service worker / background: autoridad de plan, descargas, API RedGifs, DB |
| `entrypoints/content.ts` | Content script para `*.redgifs.com` (todos los frames) |
| `entrypoints/reddit.content.ts` | Content script para `reddit.com` |
| `entrypoints/popup/` | Popup React (`App.tsx`, `main.tsx`, `index.html`, CSS) |
| `entrypoints/offscreen/` | Documento offscreen de Chrome |
| `utils/` | Lógica compartida: `links-db`, `mp4-metadata`, `license`, `license-config`, `edition`, `download-options`, `messages`, `popup-i18n`, `premium-api` |
| `premium/` | Implementación **premium** (exportadores, guardado en lote, descargar todo) |
| `stubs/` | Sustituto público de `premium/` para la edición `basic` |
| `scripts/gen-icons.mjs` | Script de iconos (hoy sin uso; ver [pendiente 4](../README.md#pendiente-de-confirmar)) |
| `scripts/docs/gen-deps.mjs` | Generador de la documentación de dependencias |
| `assets/`, `public/` | Recursos estáticos (`icon.png`, `react.svg`, `wxt.svg`) |
| `.env.basic`, `.env.premium`, `.env.activated` | Solo `WXT_EDITION` por edición |
| `wxt.config.ts` | Manifiesto, alias `@premium`, hooks |
| `release-please-config.json`, `.release-please-manifest.json`, `CHANGELOG.md` | Versionado automático |
| `pnpm-lock.yaml` | Lockfile vigente |
| `package-lock.json` | **Obsoleto/ajeno** (ver pendiente 2) |
| `README-LICENCIAS.md`, `GUIA_PROBLEMAS_EXTENSIONES_WEBEXT.md`, `LEEME-v3.txt` | Documentación previa |
| `docs/` | Esta documentación |
| `scripts/docs/check-docs.mjs` | Comprueba enlaces, anclas y frescura de `docs/` |
| `.github/workflows/docs.yml`, `.github/pull_request_template.md` | CI de documentación y plantilla de PR (nuevos, propuestos) |

Tamaño del código fuente (líneas): `content.ts` 1553, `background.ts` 604, `premium/exporters.ts` 570, `popup/App.tsx` 749, `utils/links-db.ts` 364, `utils/license.ts` 286, `reddit.content.ts` 260.
