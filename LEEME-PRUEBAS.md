# Cómo integrar las pruebas

1. Copia el contenido de esta carpeta a la raíz del repo (respeta las rutas).
2. Instala las dependencias de desarrollo (esto actualiza `pnpm-lock.yaml`):
   pnpm add -D vitest@^3 @vitest/coverage-v8@^3 fake-indexeddb fast-xml-parser
3. Agrega a `scripts` de package.json:
   "test": "vitest run",
   "test:watch": "vitest",
   "test:coverage": "vitest run --coverage"
4. `pnpm test`  → 193 pruebas (~5 s).
5. Haz commit de `pnpm-lock.yaml` y activa `ci-gate` como único check requerido en la rama principal.
