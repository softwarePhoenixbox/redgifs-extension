# Licencias Free / Premium para extensiones de navegador (Cloudflare Pages + D1)

Guía genérica para añadir un plan **Free** y uno **Premium** a cualquier extensión (WXT / Chrome MV3 / Firefox), con aprobación manual del dueño. Está escrita para que otro agente o persona la siga sin contexto previo. Incluye los errores reales que aparecieron al montarlo por primera vez.

Convenciones de este documento (reemplaza en tu caso):

| Marcador | Significado | Ejemplo |
|---|---|---|
| `$PROJ` | Nombre del proyecto de Cloudflare Pages del servidor de licencias (uno solo para todas tus extensiones) | `ext-licenses` |
| `<SITE>` | URL **estable** del servidor, sin `/` final | `https://ext-licenses.pages.dev` |
| `<EXT>` | Carpeta de la extensión que estás configurando | `mi-extension` |
| `<PFX>` | Prefijo corto de esa extensión para mensajes y claves de storage | `IG`, `RG`, `YT` |
| `<PRODUCT>` | Identificador de la extensión en el servidor (ver sección 8.1) | `instagram` |

Entorno de referencia: Windows + PowerShell, pnpm, WXT, Wrangler 4.x, cuenta de Cloudflare.

---

## 1. Cómo funciona (modelo mental)

```
Extensión (installId UUID) ─► Web de canje (Pages) ─► D1: fila "pending"
                                                           │
                              Admin aprueba en /admin/ ◄───┘
                                                           │
Extensión ─ GET /api/status?id=… ─► Function firma un token ECDSA P-256 (clave PRIVADA)
Extensión verifica la firma con la clave PÚBLICA embebida ─► premium = true
```

Reglas del modelo:

1. Cada instalación (navegador + perfil) genera su propio `installId` y lo guarda en `storage.local` (nunca en `storage.sync`: sync lo copiaría a todos los perfiles de la cuenta de Google).
2. **No existe "una licencia por PC".** Una extensión no puede leer ningún ID de hardware. Lo que se controla es un **email con un máximo de N instalaciones** (3 por defecto). Chrome, Firefox y Brave son instalaciones distintas, cada una con su ID.
3. El token firmado dura 7 días y se renueva cada 24 h. Sin internet, la extensión sigue en premium hasta que venza el token. Si revocas, deja de renovarse y vuelve a free.
4. **Licencia por clave (recomendada para varios navegadores/cuentas).** Apruebas a una persona creando una **clave** (`XXXX-XXXX-XXXX`) en `/admin/` y se la envías tú (por Gmail). La pega en el popup de cualquier navegador o cuenta; cada clave admite hasta N instalaciones (3 por defecto). Escribir solo un email aprobado **no** es seguro: el email no prueba quién lo escribe. La clave sí.
5. **Usos limitados (opcional).** Una clave puede tener `credits` (por ejemplo 3). Cada acción premium descuenta 1 en el servidor, compartido por todas las instalaciones de esa clave. `credits = NULL` es ilimitado. Sin conexión o sin usos, la acción premium no se ejecuta.
6. Límite honesto: el código de una extensión es JavaScript editable. La firma impide activar premium editando el storage, pero no impide parchear el código. Es un freno razonable, no una protección absoluta. Solo es sólido si la función premium vive en el servidor.

### Clave privada vs pública (fuente de confusión frecuente)

Son un **par** y deben corresponder:

| Parte | Dónde vive | Qué hace |
|---|---|---|
| Privada (`x`, `y`, **`d`**) | Solo como secreto `LICENSE_PRIVATE_JWK` en Cloudflare | Firma los tokens |
| Pública (`x`, `y`) | Dentro de **cada** extensión (`utils/license-config.ts`) | Verifica los tokens |

`d` es el secreto: nunca se pega en chats, issues ni commits. `x` e `y` son públicas. Un mismo par sirve para todas tus extensiones.

---

## 2. Archivos del sistema

### Servidor (carpeta `license-server/`, una sola para todas las extensiones)

| Archivo | Función |
|---|---|
| `wrangler.toml` | Nombre del proyecto Pages, binding D1 `DB`, variables no secretas |
| `schema.sql` | Tabla `licenses` |
| `functions/_lib.ts` | Helpers: `json`, `signToken`, `requireAdmin`, `activeCountForEmail` |
| `functions/api/redeem.ts` | `POST {installId,email}` → crea `pending`, valida el límite por email |
| `functions/api/status.ts` | `GET ?id=` → `{status}` y, si está aprobada, `{token}` |
| `functions/api/release.ts` | `POST {installId}` → el usuario libera su cupo (también libera su activación de clave) |
| `functions/api/activate.ts` | `POST {installId,key}` → asocia la instalación a una clave (valida cupo de instalaciones de forma atómica) |
| `functions/api/consume.ts` | `POST {installId}` + `Authorization: Bearer <token>` → descuenta 1 uso de la clave (atómico) |
| `functions/api/admin/keys.ts` | `GET` lista claves; `POST` `create` / `revoke` / `restore` / `set_credits` / `delete` |
| `functions/api/admin/list.ts` | `GET ?status=` (Bearer `ADMIN_TOKEN`) |
| `functions/api/admin/set.ts` | `POST {installId, action: approve\|revoke\|delete, days}` |
| `public/index.html` | Web de canje (ES/EN, acepta `?id=&lang=`) |
| `public/admin/index.html` | Panel de aprobación |
| `public/_headers` | CSP y `noindex` para `/admin/*` |

### Extensión (en cada una)

| Archivo | Función |
|---|---|
| `utils/license-config.ts` | `LICENSE_SITE` (URL estable) y `LICENSE_PUBLIC_JWK` (`x`,`y`) |
| `utils/license.ts` | `getInstallId`, `verifyToken`, `isPremium`, `readLicense`, `refreshLicense`, `releaseLicense` |
| `utils/messages.ts` (o equivalente) | Mensajes `<PFX>_LICENSE_GET` y `<PFX>_LICENSE_RELEASE`, campo `license` en la respuesta |
| `entrypoints/background.ts` | `requirePremium()` en cada acción premium (**autoridad real**) |
| `entrypoints/popup/App.tsx` | Botón ⭐, ID con copiar, "Obtener Premium", "Check status", "Liberar", controles con 🔒 |
| textos i18n del popup | Textos del estado de licencia (ES/EN) |
| content scripts | Leen una bandera `<pfx>Premium` del storage solo para elegir opciones por defecto; **no** deciden nada |
| `wxt.config.ts` | `host_permissions` incluye el origen de `LICENSE_SITE`; `data_collection_permissions` de Firefox |
| `scripts/gen-license-keys.mjs` | Genera el par de claves ECDSA P-256 (solo se usa una vez en total) |
| `utils/edition.ts` | Constante `EDITION` (`basic`/`premium`/`activated`) fijada al compilar |
| `utils/premium-api.ts` | Interfaz de las funciones premium separables |
| `premium/` | **Implementación premium** (carpeta que va a un repo privado/submódulo) |
| `stubs/premium.ts` | Sustituto público que lanza "no incluido en la edición básica" |
| `.env.basic`, `.env.premium`, `.env.activated` | `WXT_EDITION=<edición>` leído por `wxt build --mode <edición>` |

Esquema D1:

```sql
CREATE TABLE IF NOT EXISTS licenses (
  install_id TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('pending','approved','revoked','released')),
  expires_at INTEGER,            -- unix seconds; NULL = sin vencimiento
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses(email);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);

-- Licencias por clave (en schema.sql; se puede re-ejecutar sin riesgo)
CREATE TABLE IF NOT EXISTS license_keys (
  key_hash TEXT PRIMARY KEY,        -- SHA-256 de la clave; la clave en claro no se guarda
  key_hint TEXT NOT NULL,           -- últimos 4 caracteres para reconocerla en el panel
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','revoked')),
  max_installs INTEGER NOT NULL DEFAULT 3,
  credits INTEGER,                  -- usos restantes; NULL = ilimitado
  expires_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS activations (
  install_id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

Token: el payload puede llevar `lim: true` cuando la clave tiene usos limitados. `/api/status` responde `{status, token, metered, remaining}`. Una instalación con clave y otra aprobada por el flujo anterior (`licenses`) conviven; la clave tiene prioridad.

Formato del token: `base64url(JSON{v:1,id,plan:"premium",iat,exp}) + "." + base64url(firma ECDSA P-256 SHA-256 sobre el TEXTO base64url del payload)`. La firma es la cruda `r||s` de WebCrypto en ambos lados (Workers y navegador); no convertir a DER.

---

## 3. Montar el servidor (una sola vez, para todas las extensiones)

Todos los comandos en PowerShell. **El orden importa** (ver errores, sección 7).

```powershell
$PROJ = "ext-licenses"     # elige un nombre; será <PROJ>.pages.dev
```

### 3.1 Par de claves (sin copiar y pegar)

Pegar la clave en el prompt de PowerShell falló varias veces y dejó secretos vacíos. Genera el par directamente en un archivo (desde cualquier carpeta con Node):

```powershell
node -e "const {generateKeyPairSync}=require('crypto');const k=generateKeyPairSync('ec',{namedCurve:'P-256'});const pr=k.privateKey.export({format:'jwk'});const pu=k.publicKey.export({format:'jwk'});require('fs').writeFileSync(process.env.USERPROFILE+'\\priv.json',JSON.stringify({kty:pr.kty,crv:pr.crv,x:pr.x,y:pr.y,d:pr.d}));console.log(JSON.stringify({x:pu.x,y:pu.y}))"
(Get-Content $env:USERPROFILE\priv.json -Raw).Length    # debe dar ~240. Si da 0, NO continuar.
```

- La salida de pantalla es la parte pública (`x`,`y`) → va en `license-config.ts` de cada extensión.
- `priv.json` es la privada → se sube como secreto. **Guarda una copia en un gestor de contraseñas** antes de borrarla. Si se pierde, hay que rotar y publicar una versión nueva de cada extensión.

### 3.2 Base de datos D1

```powershell
cd license-server
npx wrangler login
npx wrangler d1 create $PROJ
```

Copia el `database_id` que imprime en `wrangler.toml` (`[[d1_databases]]`, `binding = "DB"`). Ajusta también `name` y `database_name` del `wrangler.toml`. Luego:

```powershell
npx wrangler d1 execute $PROJ --remote --file=schema.sql
```

### 3.3 Proyecto Pages, secretos y deploy (en este orden)

```powershell
npx wrangler pages project create $PROJ --production-branch main

# Contraseña del panel admin (16+ caracteres). Guárdala en un gestor.
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
npx wrangler pages secret put ADMIN_TOKEN --project-name $PROJ

# Clave privada: SIEMPRE por pipe desde un archivo con contenido
Get-Content $env:USERPROFILE\priv.json -Raw | npx wrangler pages secret put LICENSE_PRIVATE_JWK --project-name $PROJ

# (opcional) aviso por correo con Resend
npx wrangler pages secret put RESEND_API_KEY --project-name $PROJ

# Deploy DESDE la carpeta license-server (para que tome ./functions)
npx wrangler pages deploy public --project-name $PROJ
```

Después, **guarda la copia de `priv.json`** y bórrala del disco: `Remove-Item $env:USERPROFILE\priv.json`.

Variables no secretas en `wrangler.toml`: `NOTIFY_EMAIL` (tu correo), `MAX_ACTIVATIONS_PER_EMAIL` (3), `TOKEN_TTL_DAYS` (7).

### 3.4 Verificar el servidor antes de tocar ninguna extensión

```powershell
Invoke-RestMethod "https://$PROJ.pages.dev/api/status?id=00000000-0000-4000-8000-000000000000"
# esperado: status = none
```

Tras canjear y aprobar un ID real, `/api/status?id=<ID>` debe devolver `status: approved` y un `token` largo. Si devuelve `error: sign_failed`, ver sección 7.

Recomendado: proteger también `/admin/*` con Cloudflare Access permitiendo solo tu Gmail (además del `ADMIN_TOKEN`).

---

## 4. Añadir licencias a una extensión (checklist; repetir por cada extensión)

1. **Copiar** a `<EXT>`: `utils/license.ts`, `utils/license-config.ts` y, si quieres, `scripts/gen-license-keys.mjs`.
2. **Configurar** `<EXT>/utils/license-config.ts`:
   - `LICENSE_SITE = '<SITE>'` (la URL **estable**, sin `/` final).
   - `LICENSE_PUBLIC_JWK`: `x` e `y` de la clave pública del par que usa el servidor.
3. **`wxt.config.ts`**:
   - Añadir `` `${new URL(LICENSE_SITE).origin}/*` `` a `host_permissions`.
   - Firefox: `data_collection_permissions: { required: ['technicalAndInteraction'] }` (se envía el ID al servidor).
4. **Mensajes**: añadir a los tipos de request `{ type: '<PFX>_LICENSE_GET'; refresh?: boolean }` y `{ type: '<PFX>_LICENSE_RELEASE' }`, y `license?: LicenseState` a la respuesta.
5. **`background.ts`**:
   - `import { PREMIUM_REQUIRED_MESSAGE, getInstallId, isPremium, readLicense, refreshLicense, releaseLicense } from '../utils/license'`.
   - `async function requirePremium() { if (!(await isPremium())) throw new Error(PREMIUM_REQUIRED_MESSAGE); }`.
   - Manejar `<PFX>_LICENSE_GET` (`refreshLicense(refresh)`) y `<PFX>_LICENSE_RELEASE`.
   - Llamar `await requirePremium()` **al inicio de cada acción premium**. La validación en el background es la autoridad; el popup solo oculta controles.
   - En el arranque: `void getInstallId().then(() => readLicense())`.
6. **Popup**: bloque de licencia (ID, copiar, "Obtener Premium" → `${site}/?id=<ID>&lang=<idioma>`, "Check status", "Liberar"), y 🔒 en lo premium. Al abrir, si el estado es `pending`, forzar `refresh`.
7. **Content scripts**: leer la bandera de premium (`rgPremium` en la implementación de referencia; usa un nombre con tu prefijo) del storage para forzar las opciones por defecto del plan free. Solo UX.
8. `license.ts` guarda `installId`, token, estado, fecha de última consulta y la bandera premium en `storage.local`. Cada extensión tiene su propio storage, así que no hay colisión entre extensiones.
9. Si usas el mismo servidor para varias extensiones, aplica además la sección 8.1 (`<PRODUCT>`).
10. **Ediciones** (sección 6.1): crear `utils/edition.ts`, `utils/premium-api.ts`, `premium/`, `stubs/premium.ts`, los `.env.*` y la config de WXT; mover el código premium a `premium/` y llamarlo desde el background a través de `@premium` **después** de `requirePremium()`.
11. **Compilar y probar** (sección 6).

### Matriz Free / Premium (rellenar por extensión)

Decide qué es premium **antes** de programar, y bloquea cada fila en el background.

| Función | Free | Premium | Dónde se bloquea (handler del background) |
|---|---|---|---|
| (ej.) Descarga en calidad estándar | sí | sí | — |
| (ej.) Calidad alta / formatos extra | no | sí | handler de descarga: si la calidad ≠ estándar, `requirePremium()` |
| (ej.) Descarga masiva | no | sí | handler `DOWNLOAD_ALL` |
| (ej.) Exportar datos | no | sí | handler `EXPORT` |
| (ej.) Selección en lote | no | sí | handler `SAVE_BULK` |
| (ej.) Importar datos | sí | sí | — |

Para un downloader de redes sociales, una división típica: Free = calidad estándar y el elemento actual; Premium = máxima calidad, todos los elementos / lote, formatos alternativos (WEBP/PNG), captura de fotograma y exportación.

---

## 5. Aprobar y operar

### 5.0 Con clave (recomendado)

1. En `<SITE>/admin/` → sección **Claves de licencia** → escribe el email, los usos (vacío = ilimitado, p. ej. `3`), instalaciones máximas (3) y duración → **Crear clave**.
2. El panel muestra la clave **una sola vez** (cópiala). En la base solo queda su hash.
3. Envíasela al usuario por correo. En cualquier navegador o cuenta: popup → ⭐ → pega la clave → **Activar**.
4. Puedes **Fijar usos** (recargar), **Revocar** (todas sus instalaciones vuelven a free en la próxima consulta) o **Borrar**.
5. El usuario puede **Liberar esta instalación** para mover el cupo a otro navegador. Los usos no se recuperan al liberar: pertenecen a la clave.

Definición de "un uso": una llamada a `requirePremium()` en el background (una descarga HD/JPG/captura, un Download all, una exportación o un guardado en lote cuentan 1 cada uno). Se descuenta **antes** de ejecutar la acción; si la acción falla después, el uso no se devuelve. Para cambiar la unidad, mueve la llamada a `requirePremium()` al punto que quieras contar.

### 5.1 Por instalación (flujo anterior, sigue funcionando)

1. El usuario abre el popup → ⭐ → "Obtener Premium": se abre la web de canje con su ID prellenado → escribe su email → "Solicitar Premium".
2. Tú abres `<SITE>/admin/`, pegas `ADMIN_TOKEN`, eliges "Pendientes", **Cargar**, eliges duración (Permanente / 30 días / 1 año) y **Aprobar**.
3. El usuario pulsa "Check status" en el popup → Premium.
4. **Revocar** deja la licencia en `revoked`; no se puede saltar con "Liberar" ni volver a canjear.
5. Un email con 3 instalaciones activas (pendientes o aprobadas) no puede pedir una cuarta hasta que libere una.

---

## 6. Compilar y probar la extensión

```powershell
pnpm build           # Chrome
pnpm build:firefox   # Firefox
pnpm compile         # tsc --noEmit
```

Chrome: `chrome://extensions` → modo desarrollador → recargar / cargar `.output\chrome-mv3`. Después de cambiar `license-config.ts` **siempre** recompilar y recargar.

Prueba de punta a punta: popup en plan Free (controles con 🔒) → canje → aprobación → "Check status" → insignia "Premium" y "Premium active · Valid until …".

### 6.1 Tres builds: basic, premium y activated

| Edición | Comando | Qué incluye | Para quién |
|---|---|---|---|
| `basic` | `pnpm build:basic` | Solo funciones normales. **Sin** código premium ni llamadas al servidor | Tienda pública / usuarios free |
| `premium` | `pnpm build:premium` (o `pnpm build`) | Todo, con premium bloqueado hasta activar clave/licencia | Quien paga |
| `activated` | `pnpm build:activated` | Todo, premium ya activo, sin servidor | **Solo tú.** Nunca publicar ni repartir |

Salidas: `.output/chrome-mv3-basic`, `chrome-mv3-premium`, `chrome-mv3-activated` (WXT añade el sufijo del modo). Los `zip:basic` y `zip:premium` empaquetan para subir. Firefox: añade `-b firefox`.

Cómo se separa el código:

- Todo lo premium separable vive en `premium/` (exportar, descarga masiva, guardado en lote) detrás de la interfaz `PremiumApi`. El background lo importa como `import { premium } from '@premium'`.
- En `wxt.config.ts`, `alias['@premium']` apunta a `stubs/premium` si el modo es `basic` y a `premium` en cualquier otro. Se decide leyendo `--mode` de la línea de comandos (ver error 13).
- En `basic` el manifest no incluye el host del servidor de licencias y declara `data_collection_permissions: none`.
- Verificación: compara tamaños y busca marcas en el bundle, busca una cadena que solo exista en el código premium (p. ej. el nombre de archivo de una exportación): `grep -o "<cadena>" .output/chrome-mv3-basic/background.js` debe dar 0 coincidencias en basic y al menos 1 en premium/activated.

**Código premium fuera del build `basic` (constante de compilación):** además de `premium/`, todo lo premium que comparte archivos con las funciones normales (HD, JPG, captura de frame, selección en página, botones de exportar) se protege con `HAS_PREMIUM` (`utils/edition.ts`: `import.meta.env.WXT_EDITION !== 'basic'`). Cada rama va como `if (HAS_PREMIUM && ...)`. En `basic` vale `false`, el bundler elimina esas ramas y las funciones que solo ellas usaban (canvas/`toDataURL`, `RG_OFFSCREEN_PREPARE_IMAGE_BLOB`, exportadores, guardado en lote, `/api/consume`, etc.). Reglas para otra extensión: (1) toda función premium se llama solo desde un `if (HAS_PREMIUM)`; (2) no la dejes referenciada desde código que siempre corre; (3) los `addEventListener` de UI premium también van dentro del `if`; (4) verifica siempre con grep sobre `.output/chrome-mv3-basic` (comando abajo). Quedan solo textos/identificadores sueltos (nombres de mensajes en el `switch` del background que responden "Not available in the basic edition", etiquetas i18n), sin lógica.

Verificación del build basic (PowerShell; debe dar 0 en todo salvo etiquetas):

```powershell
pnpm build:basic
foreach ($p in 'toDataURL','image/jpeg','RG_OFFSCREEN_PREPARE_IMAGE','api/consume','sheet.xml') {
  "$p : " + (Get-ChildItem .output\chrome-mv3-basic -Recurse -Filter *.js | Select-String -SimpleMatch $p -List).Count
}
```

### 6.2 Repositorio privado para `premium/`

`.gitignore` con `premium/*` oculta la carpeta de tu repo, pero no protege el paquete que publicas ni ayuda a CI o a otra máquina. Mejor un **submódulo** de git:

```powershell
# 1) Crea un repo PRIVADO (p. ej. ext-premium) y sube a su raíz el contenido de premium/ (index.ts, exporters.ts)
# 2) En el repo público, quita la carpeta y móntala como submódulo en el mismo sitio
git rm -r premium
git submodule add git@github.com:<usuario>/ext-premium.git premium
git commit -m "premium como submódulo privado"
```

- Clonar con todo: `git clone --recurse-submodules <repo-publico>`; después `git submodule update --init`.
- CI para `basic`: no necesita el submódulo (usa `stubs/`). Para `premium`: darle una deploy key de solo lectura al repo privado.
- `pnpm compile` (tsc) necesita `premium/` presente porque el alias de tipos apunta ahí; en un entorno sin acceso, compila solo `basic` con `wxt prepare --mode basic` y revisa tipos contra `stubs/`.
- `.env`/`.env.*` solo llevan configuración de compilación (`WXT_EDITION`). No guardes ahí ningún secreto: todo lo que entra al bundle es legible por cualquiera que instale la extensión.
- El build `activated` y su `.output` no se suben a ningún repo ni a la tienda.

---

## 7. Errores encontrados y su solución

| # | Síntoma | Causa | Solución |
|---|---|---|---|
| 1 | `Cannot find module '...\scripts\gen-license-keys.mjs'` | El script se ejecutó desde otra carpeta (la del servidor); vive en la carpeta de la **extensión** | `cd` a la carpeta correcta, o usar el comando de una línea de 3.1 que no depende de ningún archivo |
| 2 | `Project "<PROJ>" does not exist` al hacer `pages secret put` | Se saltó `pages project create` | Orden correcto: d1 create → schema → `pages project create` → secretos → deploy |
| 3 | Se puso la URL con hash (`ca128238.<PROJ>.pages.dev`) en `LICENSE_SITE` | Esa URL es de un despliegue puntual y cambia en cada deploy | Usar la URL estable `https://<PROJ>.pages.dev` |
| 4 | Error 1101 "Worker threw exception" en `/api/status` de un ID aprobado | La Function no pudo firmar el token (secreto ausente/vacío/mal formado). `none` y `pending` no firman, por eso funcionaban | Parche de diagnóstico (abajo) y recargar el secreto |
| 5 | El diagnóstico devolvió `secretPresent:false, secretLength:0` aunque `secret list` mostraba `LICENSE_PRIVATE_JWK` | El secreto se subió **vacío**. Wrangler imprime "Success" aunque la entrada esté vacía | Comprobar `Length > 0` antes de subir; usar el generador que escribe `priv.json` directo |
| 6 | `Get-Content : Cannot find path priv.json` seguido de "Success! Uploaded secret" | El pipe no envió nada; Wrangler guardó vacío | Crear el archivo primero y verificar su longitud |
| 7 | `priv.json` existía pero `Length` = 0 | Se guardó vacío (nada pegado) | No pegar a mano: generar con el comando de una línea de 3.1 |
| 8 | Secreto cargado pero el servidor no lo ve | Los secretos solo aplican a despliegues **nuevos** | Volver a ejecutar `pages deploy` después de cada `secret put` |
| 9 | El servidor responde `approved` + token, pero el popup dice "License expired or could not be re-checked" | `x`,`y` de `license-config.ts` no son del mismo par que la privada del servidor (se había regenerado el par), o no se recompiló/recargó | Copiar `x`,`y` desde `priv.json`, `pnpm build`, recargar la extensión, "Check status" |
| 10 | El popup mostraba "Not requested yet" aunque el ID estaba aprobado | Estado en caché (24 h) y el servidor devolvía 500 al firmar; la extensión ignoraba el error sin avisar | Botón "Check status" (fuerza consulta). Mejora pendiente: mostrar el error del servidor (8.2) |
| 11 | Al recargar la extensión cambió el ID | Cargar el build desde otra carpeta o reinstalar crea una instalación nueva con storage vacío | Aprobar el ID nuevo en `/admin/`. En producción (tienda) el ID es estable |
| 12 | Se pegó el JSON con `d` en un chat | La privada quedó expuesta | Rotar el par antes de publicar (sección 9). Para pedir ayuda basta con `x` e `y` |
| 13 | `defineConfig(({ mode }) => …)` falla ("has no properties in common with UserConfig" / `mode` undefined) y un alias puesto en `vite.resolve.alias` no pisaba al de `alias` (el build `basic` seguía incluyendo `premium/`) | WXT evalúa `wxt.config.ts` antes de cargar los `.env` y esta versión no admite función como config; el `alias` de WXT gana sobre el de `vite` | Dejar `defineConfig({...})` como objeto, usar `manifest: ({ mode }) => …` (sí admite función) y decidir `alias` leyendo `--mode` de `process.argv` |
| 14 | El build `basic` pesaba casi igual que el premium | El alias no se aplicó (ver 13) | Comparar tamaños y buscar marcas del código premium en `background.js` tras cada cambio de config |
| 15 | Con error de servidor, el popup se quedaba mostrando el estado viejo | `refreshLicense` ignoraba las respuestas no-OK | Con `force=true` (botón "Check status") los errores se lanzan y el popup los muestra: `server_500`, `bad_signature` (clave pública distinta a la del servidor), `network`, etc. |

Parche de diagnóstico en `functions/api/status.ts` (no filtra el contenido del secreto):

```ts
if (row.status === 'approved') {
  if (row.expires_at !== null && row.expires_at <= now()) return json({ status: 'expired' });
  try {
    return json({ status: 'approved', token: await signToken(env, id, row.expires_at) });
  } catch (e) {
    return json({
      error: 'sign_failed',
      errorName: e instanceof Error ? e.name : 'unknown',
      secretPresent: Boolean(env.LICENSE_PRIVATE_JWK),
      secretLength: env.LICENSE_PRIVATE_JWK ? env.LICENSE_PRIVATE_JWK.length : 0,
    }, 500);
  }
}
```

Interpretación: `secretPresent:false` → secreto vacío/ausente. `SyntaxError` → no es JSON válido. `DataError`/`OperationError` → es JSON pero no es una clave privada P-256 completa (falta `d`, o se subió la pública). Respuesta `approved` + token → servidor correcto, el problema está en la extensión (error 9).

Diagnóstico rápido por capas:

0. Si migras un servidor ya desplegado a claves: `npx wrangler d1 execute $PROJ --remote --file=schema.sql` (crea `license_keys` y `activations`; las tablas existentes no se tocan) y `pages deploy`.
1. `GET <SITE>/api/status?id=<ID>` en el navegador → ¿`pending`, `approved` + token, o error? Esto separa servidor de extensión.
2. Si es `approved` + token y el popup falla → comparar `x`,`y` con `priv.json`, recompilar, recargar.
3. Si el popup muestra un ID distinto del aprobado → aprobar ese ID en `/admin/`.

---

## 8. Mejoras recomendadas (aún NO aplicadas en el código de referencia)

### 8.1 Varias extensiones en el mismo servidor (`<PRODUCT>`)

El servidor ya funciona con varias extensiones (cada instalación tiene un UUID distinto), pero hoy el límite de 3 activaciones se cuenta **por email entre todas las extensiones**, y un token no está atado a una extensión concreta. Para separarlas:

1. Migración D1:
   ```powershell
   npx wrangler d1 execute $PROJ --remote --command "ALTER TABLE licenses ADD COLUMN product TEXT NOT NULL DEFAULT 'default'; CREATE INDEX IF NOT EXISTS idx_licenses_email_product ON licenses(email, product);"
   ```
2. `redeem.ts`: aceptar `product` (lista blanca fija en el servidor, p. ej. `['instagram','youtube',…]`) y guardarlo. `activeCountForEmail(env, email, product, excludeId)` debe filtrar `AND product = ?`.
3. `signToken`: añadir `prod` al payload.
4. Cada extensión: constante `PRODUCT` en `license-config.ts`; `verifyToken` exige `payload.prod === PRODUCT`; el enlace "Obtener Premium" añade `&product=<PRODUCT>` y la web de canje lo envía a `/api/redeem`.
5. `admin/list.ts` y el panel: mostrar y filtrar por `product`.

Esto cambia el formato del token: actualiza el servidor y todas las extensiones a la vez. Si ya hay filas antiguas, quedan con `product = 'default'`.

### 8.2 Mostrar el error real del servidor en el popup

**Aplicado** (ver error 15).

### 8.3 Generador de claves que escribe `priv.json`

Hacer que `scripts/gen-license-keys.mjs` escriba `%USERPROFILE%\priv.json` (como el comando de 3.1) e imprima solo la parte pública, para eliminar el copiar y pegar.

### 8.4 Otros

- Cloudflare Access sobre `/admin/*` (permitir solo tu Gmail).
- Cloudflare Turnstile en la web de canje si recibes spam. Hoy hay un tope global de 500 solicitudes pendientes.
- Pago real: hoy la aprobación es manual. Para cobrar automáticamente se puede añadir un webhook (Stripe, Lemon Squeezy) que apruebe la fila `pending`.
- Política de privacidad de cada tienda: mencionar el ID de instalación y el email que se escribe en la web de canje.

---

## 9. Rotar las claves (antes de publicar o si se filtró `d`)

1. Generar un par nuevo (3.1).
2. Poner `x`,`y` nuevas en `license-config.ts` de **todas** las extensiones.
3. `Get-Content $env:USERPROFILE\priv.json -Raw | npx wrangler pages secret put LICENSE_PRIVATE_JWK --project-name $PROJ`
4. `npx wrangler pages deploy public --project-name $PROJ`
5. `pnpm build` y publicar una versión nueva de cada extensión.

Las licencias aprobadas no se pierden (están en D1). Las extensiones con la pública vieja dejan de validar tokens nuevos y vuelven a free hasta actualizarse.

---

## 10. Seguridad: lo que nunca se hace

- No pegar `d` ni el contenido de `priv.json` en chats, issues, commits ni capturas.
- No guardar `ADMIN_TOKEN` ni la privada en el repositorio. `priv.json` se queda fuera de las carpetas de proyectos.
- No confiar solo en el popup o el content script: toda función premium se valida en el background.
- No usar `storage.sync` para el `installId` ni el token.
- No poner la URL con hash de un despliegue en `LICENSE_SITE`.
