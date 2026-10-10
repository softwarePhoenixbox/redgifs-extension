---
title: Puesta en marcha local
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 90
sources:
  - package.json
  - wxt.config.ts
  - .env.basic
  - .env.premium
  - .env.activated
---

# Puesta en marcha local

Cómo instalar, compilar y cargar la extensión en Chrome o Firefox. Léelo antes de tocar código.

## Requisitos

- Node.js (el repo no fija versión; verificado con **22.22.0**) — [pendiente 1](../README.md#pendiente-de-confirmar).
- pnpm **12.5.1** (campo `packageManager` de `package.json`): `npm i -g pnpm@12.5.1`.
- Chrome/Chromium o Firefox.

## Pasos

1. Instalar dependencias (ejecuta `wxt prepare` en `postinstall`):
   ```bash
   pnpm install --frozen-lockfile
   ```
2. Comprobar tipos:
   ```bash
   pnpm compile
   ```
3. Modo desarrollo con recarga (abre un navegador con la extensión):
   ```bash
   pnpm dev            # Chrome
   pnpm dev:firefox    # Firefox
   ```
4. O compilar un paquete concreto y cargarlo a mano:

| Comando | Salida | Edición |
| --- | --- | --- |
| `pnpm build:basic` | `.output/chrome-mv3-basic/` | solo plan gratis; **sin** código premium |
| `pnpm build:premium` | `.output/chrome-mv3-premium/` | premium bloqueado hasta activar licencia |
| `pnpm build:activated` | `.output/chrome-mv3-activated/` | premium activo, **uso personal, no publicar** |
| `pnpm build:all` | los tres anteriores | — |
| `pnpm build` / `pnpm dev` (sin `--mode`) | `.output/chrome-mv3/` | se comporta como `premium` |
| `pnpm wxt build --mode basic -b firefox` | `.output/firefox-mv2-basic/` | Firefox |
| `pnpm zip:basic`, `pnpm zip:premium`, `pnpm zip:firefox` | `.zip` para tiendas | — |

5. Cargar la extensión: Chrome → `chrome://extensions` → «Modo desarrollador» → «Cargar descomprimida» → carpeta de `.output/...`. Firefox → `about:debugging` → «Cargar complemento temporal» → `manifest.json` de la carpeta.
6. Probar: abrir `https://www.redgifs.com/`, activar «Show “On-screen video” panel» en el popup o usar el icono de descarga junto a las acciones del video.

Verificado el 2026-10-10 en Linux (Node 22.22.0, pnpm 12.5.1): los pasos 1, 2 y los builds `basic`, `premium`, `activated` y Firefox `basic` terminaron sin errores en ~1,5 s cada uno. **No verificado**: pasos 3, 5 y 6 (requieren un navegador con interfaz).

## Qué edición usar para desarrollar

- Para trabajar en funciones premium sin servidor de licencias: `activated` (no consulta al servidor).
- Para comprobar que `basic` no arrastra código premium: tras `pnpm build:basic`, buscar cadenas premium en `.output/chrome-mv3-basic` (por ejemplo `spreadsheetml` no debe aparecer). Verificado el 2026-10-10.
- Para probar el flujo real de licencias: `premium` y un servidor de licencias propio ([servidor](../13-security/editions-and-licensing.md#servidor-de-licencias)).
