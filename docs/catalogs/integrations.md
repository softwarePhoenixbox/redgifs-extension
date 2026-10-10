---
title: Integraciones con terceros
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - wxt.config.ts
  - utils/license.ts
  - entrypoints/background.ts
---

# Integraciones

| Tercero | Para qué | Autenticación | Si falla | Doc |
| --- | --- | --- | --- | --- |
| RedGifs API / media | Resolver GIFs y descargar | Token temporal anónimo | Mensajes de error al usuario; 429 se informa | [API](../04-apis/redgifs-api.md) |
| Servidor de licencias (Cloudflare Pages + D1) | Activar y consultar licencias (solo `premium`) | `installId` + clave; token firmado ECDSA | Gracia offline: se conserva el token en caché hasta que venza; con licencia por usos, sin conexión no se ejecuta la acción | [Licencias](../13-security/editions-and-licensing.md) |
| Reddit | Solo se inyecta un content script; no se llama a su API | — | — | [content-reddit](../03-services/content-reddit.md) |
