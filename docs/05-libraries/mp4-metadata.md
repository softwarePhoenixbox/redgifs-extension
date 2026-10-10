---
title: mp4-metadata (módulo interno)
owner: pendiente-de-confirmar
status: production
last_reviewed: 2026-10-10
review_every_days: 180
sources:
  - utils/mp4-metadata.ts
---

# `utils/mp4-metadata.ts`

Inserta metadatos en un MP4 **sin recodificar**, escribiendo cajas (boxes) dentro de `moov/udta`.

## API pública

```ts
embedMp4Metadata(input: Uint8Array, metadata: Mp4Metadata): Uint8Array
interface Mp4Metadata { title?, author?, tags?: string[], pageUrl? }  // todos opcionales
```

## Qué escribe

| Caja | Campos |
| --- | --- |
| `udta/Xtra` (Windows) | `WM/Title`, `WM/Author`, `WM/Category` (tags unidos por espacio), `WM/PromotionURL` (URL de la página) |
| `udta/meta/ilst` (QuickTime) | `©nam` (título), `©ART` (autor); tags y URL no se escriben aquí |

Fuente: `xtraPayload` y `quickTimePayload`.

## Reglas y límites

- Lanza `MP4 inválido: box <tipo>` si los tamaños de caja no cuadran.
- Si ya existe `udta`, reemplaza la caja del mismo tipo o añade al final y ajusta los tamaños (`injectUdtaBox`); si no, crea `udta`.
- Solo se usa para `.mp4`/`.m4v`. Se ejecuta en el offscreen (Chrome) o en el background (Firefox).
- No hay pruebas unitarias. **No verificado** con un reproductor/explorador real.
