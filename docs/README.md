---
title: Índice maestro de la documentación
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - package.json
  - wxt.config.ts
---

# Documentación de RedGifs Extension

Índice por intención para la extensión de navegador **RedGifs Extension** (WXT + TypeScript + React, Chrome MV3 y Firefox MV2). Está pensada para quien llega nuevo al repo y para quien mantiene las ediciones de build (`basic`, `premium`, `activated`).

| Quiero... | Lee |
| --- | --- |
| Entender qué es y qué hace | [Visión general](00-overview/project-overview.md) |
| Ver cómo encajan las piezas | [Arquitectura](00-overview/architecture.md) y [flujo de datos](02-architecture/data-flow.md) |
| Saber qué hay en cada carpeta | [Mapa del repositorio](00-overview/repository-map.md) |
| Versiones y herramientas | [Stack](00-overview/tech-stack.md) (generado) |
| Levantarlo en mi máquina | [Puesta en marcha local](01-getting-started/local-setup.md) |
| Resolver un fallo conocido | [Troubleshooting](01-getting-started/troubleshooting.md) |
| Entender un componente | [Background](03-services/background.md) · [Content script RedGifs](03-services/content-redgifs.md) · [Content script Reddit](03-services/content-reddit.md) · [Popup](03-services/popup.md) · [Offscreen](03-services/offscreen.md) |
| Ver los mensajes internos | [Protocolo de mensajes](04-apis/messages.md) |
| Ver qué consume de RedGifs | [API de RedGifs](04-apis/redgifs-api.md) |
| Cambiar qué es gratis y qué premium | [Ediciones y licencias](13-security/editions-and-licensing.md) |
| Ver permisos del manifiesto | [Permisos](13-security/permissions.md) |
| Tocar la base de datos local | [Base de datos](07-data/database.md) |
| Ver claves de `storage.local` | [Catálogo de storage](catalogs/storage-keys.md) |
| Actualizar una dependencia | [Índice de dependencias](06-dependencies/index.md) y [política](06-dependencies/upgrade-policy.md) |
| Publicar una versión | [Versionado y releases](15-releases/versioning-and-releases.md) |
| Saber por qué se decidió algo | [ADR](02-architecture/decisions/) |

## Documentos que ya existían en el repo

- `README-LICENCIAS.md`: guía del **servidor de licencias** (Cloudflare Pages + D1), que vive fuera de este repositorio. Aquí solo se resume el lado cliente.
- `GUIA_PROBLEMAS_EXTENSIONES_WEBEXT.md`: lista de diagnóstico de problemas Chrome/Firefox ya resueltos.
- `LEEME-v3.txt`: nota de la actualización v3 (basic sin código premium).

## Cómo regenerar lo generado

```bash
pnpm install
node scripts/docs/gen-deps.mjs   # actualiza 06-dependencies/index.md y 00-overview/tech-stack.md
```

Verificado el 2026-10-10 en Linux (Node 22.22.0, pnpm 12.5.1).

## Pendiente de confirmar

Preguntas abiertas que el código no responde. Cada una indica a quién hacérsela (el repo no tiene `CODEOWNERS`; se asume la persona dueña del repositorio `softwarePhoenixbox/redgifs-extension`, según `LICENSE` y `CHANGELOG.md`).

| # | Pregunta | A quién |
| --- | --- | --- |
| 1 | ¿Qué versión de Node es la soportada? No hay `engines` ni `.nvmrc`; se verificó con Node 22.22.0. | Dueño del repo |
| 2 | `package-lock.json` es de **otro proyecto** (`name: "instagram download"`, versión 0.1.8) y resuelve `typescript@5.9.3`. El lock real es `pnpm-lock.yaml`. ¿Se borra `package-lock.json`? | Dueño del repo |
| 3 | `@ffmpeg/core`, `@ffmpeg/ffmpeg` y `@ffmpeg/util` están en `dependencies` pero ningún archivo los importa. ¿Se eliminan? (`@ffmpeg/core` es GPL-2.0-or-later.) | Dueño del repo |
| 4 | `scripts/gen-icons.mjs` lee `assets/icon-square.png` y escribe en `public/icon/`, que no existen; los iconos reales los genera `@wxt-dev/auto-icons`. ¿Se elimina el script? | Dueño del repo |
| 5 | `package.json` tiene `"description": "manifest.json description"` (texto de plantilla). ¿Cuál es la descripción pública? | Dueño del repo |
| 6 | La carpeta `premium/` ¿ya está en un repositorio privado/submódulo? El código dice que «se mueve», pero aquí está en el repo. | Dueño del repo |
| 7 | No hay CI en el repo (ni `.github/workflows`), pero hay configuración de `release-please`. ¿Dónde corre? | Dueño del repo |
| 8 | No hay pruebas automáticas. ¿Se planean? | Dueño del repo |
| 9 | Estado de publicación en tiendas (Chrome Web Store, AMO): no consta en el repo. | Dueño del repo |
