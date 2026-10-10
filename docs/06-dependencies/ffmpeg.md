---
title: Dependencias @ffmpeg/* (sin uso detectado)
owner: pendiente-de-confirmar
status: needs-review
last_reviewed: 2026-10-10
review_every_days: 30
sources:
  - package.json
  - pnpm-lock.yaml
---

# `@ffmpeg/core`, `@ffmpeg/ffmpeg`, `@ffmpeg/util`

Declaradas en `dependencies` (`0.12.10`, `^0.12.15` → `0.12.15`, `^0.12.2` → `0.12.2`) pero **ningún archivo del repo las importa** (búsqueda de `from '@ffmpeg/…'` el 2026-10-10; el generador de [dependencias](index.md) también lo marca).

- Licencia de `@ffmpeg/core`: GPL-2.0-or-later; las otras dos, MIT (leído de `node_modules`).
- Los builds verificados (`chrome-mv3-*`) no contienen chunk de ffmpeg (lista de archivos de `.output/`).
- Acción sugerida: confirmar y eliminarlas ([pendiente 3](../README.md#pendiente-de-confirmar)); la incrustación de metadatos se hace sin ffmpeg ([ADR 0003](../02-architecture/decisions/0003-metadatos-mp4-sin-recodificar.md)).
