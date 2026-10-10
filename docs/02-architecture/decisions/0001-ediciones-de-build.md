---
title: "ADR 0001: Ediciones de build basic / premium / activated"
owner: pendiente-de-confirmar
status: accepted
last_reviewed: 2026-10-10
review_every_days: 365
sources:
  - wxt.config.ts
  - utils/edition.ts
  - LEEME-v3.txt
---

# ADR 0001: Ediciones de build

Estado: aceptada. **Reconstruida a partir del código y de `LEEME-v3.txt`; confirmar con el equipo.**

## Contexto
Hay un plan gratuito y uno premium. Si el código premium viaja en el paquete público, cualquiera puede leerlo y parchearlo.

## Decisión
Compilar tres ediciones con `--mode`. En `basic`, el alias `@premium` apunta a `stubs/premium.ts` y `HAS_PREMIUM = false` permite al bundler eliminar el código premium de los content scripts y del background. `premium` exige licencia firmada. `activated` es un build personal sin servidor.

## Alternativas (deducidas)
- Un único paquete con bandera: el código premium quedaría en el paquete gratis.

## Consecuencias
- El paquete `basic` es más pequeño y sin lógica premium (`content.js` 41,46 kB frente a 47,93 kB, medido el 2026-10-10).
- Hay que mantener la firma de `PremiumApi` alineada entre `premium/` y `stubs/`.
- El alias se decide leyendo `--mode` de `process.argv` porque WXT evalúa `wxt.config.ts` antes de cargar los `.env` (comentario en el código). Una invocación sin `--mode` cae en `premium`.
