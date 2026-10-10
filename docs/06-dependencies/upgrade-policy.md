---
title: Política de actualización de dependencias
owner: pendiente-de-confirmar
status: proposed
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - package.json
  - pnpm-lock.yaml
---

# Política de actualización de dependencias

> El repo no define una política; esto es una **propuesta** basada en cómo está configurado (rangos `^`, lockfile pnpm, `@ffmpeg/core` fijado exacto). Confirmar con el dueño.

- Gestor: pnpm 12.5.1; usar siempre `pnpm install --frozen-lockfile` en CI y en builds de release.
- Revisión mensual de `pnpm outdated`; actualizaciones de seguridad de inmediato.
- Probar cada actualización mayor con `pnpm compile` y `pnpm build:all` y una prueba manual de descarga y de guardado/exportación en Chrome **y** Firefox.
- Fijadas a propósito: `@ffmpeg/core` en `0.12.10` (sin `^`).
- Sensibles: `wxt` (genera el manifiesto y empaqueta), `sql.js` (WASM y `?url` del asset), `typescript` (versión 7 declarada).
- Mientras `@ffmpeg/*` no se use, no actualizarlas: eliminarlas ([pendiente 3](../README.md#pendiente-de-confirmar)).
