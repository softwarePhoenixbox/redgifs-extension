---
title: Estrategia de pruebas
owner: pendiente-de-confirmar
status: draft
last_reviewed: 2026-10-14
review_every_days: 90
---

# Pruebas

Dos preguntas guían todo: ¿qué cuesta dinero o datos si falla? (licencias/premium, la base SQLite, las descargas) y ¿qué cambia el mundo exterior sin avisar? (la API de RedGifs, el DOM de redgifs.com y reddit.com).

## Cómo ejecutar

| Comando | Qué hace |
| --- | --- |
| `pnpm test` | Pruebas unitarias y de integración (Vitest, orden aleatorio, ~5 s) |
| `pnpm test:watch` | Modo continuo |
| `pnpm test:coverage` | Con cobertura (`coverage/lcov.info`) |
| `pnpm compile` | Tipos (`tsc --noEmit`) |
| `pnpm build:all && node scripts/check-editions.mjs` | Compila las 3 ediciones y verifica qué contiene cada una |

Reproducir un fallo de orden: `pnpm vitest run --sequence.seed=<semilla del log>`.

## Capas actuales

| Capa | Dónde | Qué prueba | Dependencias |
| --- | --- | --- | --- |
| Unitarias | `test/mp4-metadata`, `download-options`, `popup-i18n` | Parser/escritor MP4 (cajas, `stco`/`co64`), reglas de plan, paridad en/es | Ninguna |
| Integración | `test/links-db` | SQLite real (sql.js) + IndexedDB falso: upsert, migración desde esquemas antiguos, import/export, persistencia, cola | `fake-indexeddb` |
| Criptografía | `test/license` | Firmas ECDSA P-256 reales con par de claves de prueba; expiración, installId, usos limitados, offline | `fetch` simulado |
| Puerta de plan | `test/background` | Cada mensaje del background en las 3 ediciones; validación de URLs/IDs; nombres de archivo; reintentos | `fake-browser` de WXT, `fetch` simulado |
| Exportadores | `test/exporters` | XLSX válido (XML bien formado), escape/inyección en HTML, concurrencia de imágenes | `fetch` simulado |
| Humo de build | `scripts/check-editions.mjs` | `basic` sin código premium ni Reddit; permisos y CSP por edición | Build previo |

Reglas: la base de datos nunca se simula (sql.js real); lo que no controlamos (RedGifs, servidor de licencias) se simula con respuestas explícitas; las ediciones se prueban cambiando `WXT_EDITION` con `vi.stubEnv` + `vi.resetModules`.

## Hallazgos documentados con `it.fails`

Estas pruebas describen el comportamiento CORRECTO y hoy fallan a propósito. Al corregir el código pasarán a "inesperadamente verdes": elimina entonces el `.fails`.

1. `links-db.ts` — `getSql()` cachea la promesa del `.wasm` aunque falle: un error transitorio deja la base inutilizable hasta reiniciar el service worker.
2. `background.ts` (`resolveRedgifsGif`) — el filtro de "línea solo hashtags" no admite `#` interno: `#a #b` se usa como título y se incrusta en el MP4.
3. `download-options.ts` — se devuelve la constante compartida del plan gratuito (mutable). Latente: nadie la muta hoy.

## Huecos conocidos (siguiente fase)

- `content.ts` (1557 líneas), `reddit.content.ts` y `popup/App.tsx` no tienen pruebas: dependen del DOM de terceros. Plan: guardar HTML de ejemplo de redgifs.com/reddit.com y probar los selectores con Vitest + happy-dom; extraer la lógica de scraping a funciones puras.
- No hay e2e: Playwright con contexto persistente cargando `.output/chrome-mv3-activated` contra páginas guardadas (nunca contra el sitio real en CI).
- Canario nocturno (no bloqueante): una prueba que llame a la API real de RedGifs y avise si cambia el formato de `gifs/{id}`.
- Pruebas de contrato del servidor de licencias (`/api/status`, `/api/activate`, `/api/consume`, `/api/release`) cuando se versione ese servidor.

## Qué exige cada tipo de cambio

- `fix:` → una prueba que falle antes del arreglo (regresión).
- `feat:` → camino feliz + errores + comportamiento por edición (basic/premium/activated).
- Cambio en `utils/messages.ts` → actualizar `test/background.test.ts`.
- Cambio de permisos o CSP en `wxt.config.ts` → actualizar `scripts/check-editions.mjs`.
