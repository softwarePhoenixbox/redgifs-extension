import { defineConfig } from 'wxt';
import { LICENSE_SITE } from './utils/license-config';

// Edición del build: `wxt build --mode basic|premium|activated` (lee .env.<modo> → WXT_EDITION).
//  - basic:     el alias @premium apunta a stubs/ y la carpeta premium/ no entra en el paquete.
//  - premium:   funciones premium bloqueadas hasta activar una licencia (habla con el servidor).
//  - activated: premium ya activo, sin servidor. Uso personal: no publicar.
// Cualquier otro modo (p. ej. el `wxt build` normal) se comporta como `premium`.
const isLicensed = (mode: string) => mode !== 'basic' && mode !== 'activated';

// WXT evalúa este archivo ANTES de cargar los .env, así que el alias (que no admite función)
// se decide leyendo `--mode`/`-m` de la línea de comandos.
function cliMode(): string {
  const args = process.argv;
  const i = args.findIndex(a => a === '--mode' || a === '-m');
  const inline = args.find(a => a.startsWith('--mode='));
  return inline ? inline.slice('--mode='.length) : i >= 0 ? (args[i + 1] ?? '') : '';
}

export default defineConfig({
  // basic → stubs públicos (sin lógica premium); cualquier otro modo → carpeta premium/.
  alias: { '@premium': cliMode() === 'basic' ? 'stubs/premium' : 'premium' },
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  manifest: ({ mode }) => ({
    name: mode === 'activated' ? 'RedGifs Extension (activated, personal)' : 'RedGifs Extension',
    version: '0.1.54',
    permissions: ['activeTab', 'storage', 'downloads'],
    host_permissions: [
      'https://api.redgifs.com/*',
      'https://media.redgifs.com/*',
      'https://reddit.com/*',
      'https://*.reddit.com/*',
      // Solo la edición con licencia consulta al servidor.
      ...(isLicensed(mode) ? [`${new URL(LICENSE_SITE).origin}/*`] : []),
    ],
    browser_specific_settings: {
      gecko: {
        // Los GIF guardados quedan en local. La edición con licencia envía al servidor solo el ID aleatorio de la instalación
        // (el email se escribe en la web de canje, no en la extensión).
        data_collection_permissions: { required: isLicensed(mode) ? ['technicalAndInteraction'] : ['none'] },
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  }),
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      // Chrome MV3 service workers have no URL.createObjectURL; the hidden
      // offscreen document creates Blob URLs for metadata-preserving downloads.
      if (wxt.config.browser === 'chrome') {
        manifest.permissions = [...new Set([...(manifest.permissions ?? []), 'offscreen'])];
      }
    },
  },
});
