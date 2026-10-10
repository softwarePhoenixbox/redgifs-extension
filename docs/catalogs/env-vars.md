---
title: Variables de entorno y configuración de build
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 180
sources:
  - .env.basic
  - .env.premium
  - .env.activated
  - utils/edition.ts
  - utils/license-config.ts
---

# Variables de entorno

| Variable | Valores | Dónde | Efecto | Secreta |
| --- | --- | --- | --- | --- |
| `WXT_EDITION` | `basic`, `premium`, `activated` | `.env.<modo>` (leída por `wxt build --mode <modo>`) | Fija `EDITION` y `HAS_PREMIUM` (`utils/edition.ts`) | No |

Cualquier valor distinto (o ausente) se trata como `premium`.

El archivo `.env.activated` advierte: «NUNCA publiques ni repartas el paquete que sale de este modo». No guardes secretos en `.env*`: todo lo que entra al bundle es legible (`README-LICENCIAS.md` §6).

## Constantes de configuración en código (no son variables de entorno)

| Constante | Archivo | Valor / nota |
| --- | --- | --- |
| `LICENSE_SITE` | `utils/license-config.ts` | `https://redgifs-license.pages.dev` |
| `LICENSE_PUBLIC_JWK` | `utils/license-config.ts` | Clave **pública** ECDSA P-256 (`x`,`y`). La privada (`d`) vive solo en el servidor. Si está vacía, nadie obtiene premium (falla cerrado) |
