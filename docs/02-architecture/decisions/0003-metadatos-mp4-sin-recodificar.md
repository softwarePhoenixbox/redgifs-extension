---
title: "ADR 0003: Incrustar metadatos en el MP4 sin recodificar"
owner: pendiente-de-confirmar
status: accepted
last_reviewed: 2026-10-10
review_every_days: 365
sources:
  - utils/mp4-metadata.ts
  - entrypoints/background.ts
---

# ADR 0003: Metadatos MP4 sin recodificar

Estado: aceptada. **Reconstruida a partir del código; confirmar con el equipo.**

## Decisión
Descargar el MP4 con `fetch`, escribir cajas `udta/Xtra` y `udta/meta/ilst` a mano y entregar el resultado como Blob URL a la API de descargas.

## Consecuencias
- No cambia el vídeo ni requiere ffmpeg (por eso las dependencias `@ffmpeg/*` parecen sobrar: [pendiente 3](../../README.md#pendiente-de-confirmar)).
- Requiere un documento offscreen en Chrome MV3 y un `<a download>` en Firefox.
- Si falla la incrustación, se descarga el original y se avisa al usuario.
