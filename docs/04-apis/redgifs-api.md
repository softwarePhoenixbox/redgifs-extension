---
title: API de RedGifs (consumida)
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 60
sources:
  - entrypoints/background.ts
  - wxt.config.ts
---

# API de RedGifs (consumida por la extensión)

Es una API **de terceros, no documentada oficialmente aquí**: lo siguiente describe solo lo que el código usa. Puede cambiar sin aviso.

URL base: `https://api.redgifs.com/v2` (constante `REDGIFS_API`). Se llama únicamente desde el [background](../03-services/background.md).

| Método y ruta | Uso | Auth |
| --- | --- | --- |
| `GET /auth/temporary` | Obtiene un token temporal (`{token}`) con `Accept: application/json` y `referrer: https://www.redgifs.com/` | ninguna |
| `GET /gifs/<id>?views=yes` | Datos del GIF: `gif.urls.{hd,sd,thumbnail,poster}`, `title`, `description`, `userName`, `tags` | `Authorization: Bearer <token>` y cabecera `X-CustomHeader: https://www.redgifs.com/watch/<id>` |

## Comportamiento implementado

- Token en memoria; si falta, se pide antes. Con **401** se renueva el token y se reintenta **una vez**.
- **404** → `{not_found:true}`. **429** → `{rate_limited:true}`. Otro error HTTP → `{ok:false}` con el cuerpo recortado a 220 caracteres.
- Solo se aceptan URLs `https` de `redgifs.com` o subdominios en `urls.hd`/`urls.sd`/imagen. Si no hay `hd` ni `sd` → `not_found`.
- Título: `title` o, si falta, primera línea de `description` que no sea solo hashtags. Tags: se les antepone `#` si no lo tienen.
- Imagen: `urls.thumbnail` o `urls.poster` o `<video>-mobile.jpg`.

## Convenciones de media (`media.redgifs.com`)

| Variante | URL |
| --- | --- |
| HD | `https://media.redgifs.com/<Id>.mp4` |
| SD | `https://media.redgifs.com/<Id>-mobile.mp4` |
| Imagen | `https://media.redgifs.com/<Id>-mobile.jpg` |

El `<Id>` es sensible a mayúsculas (p. ej. `ZanyJudiciousRook`). Las URLs pueden vencer; el content script cachea cada resolución 5 min.

## Pruebas

Sin pruebas automáticas ni contratos. **No verificado** contra el servicio real (el entorno de trabajo no accede a `api.redgifs.com`).
