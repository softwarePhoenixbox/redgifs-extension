import { defineConfig } from 'wxt';
import { LICENSE_SITE } from './utils/license-config';

export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  manifest: {
    name: 'RedGifs Extension',
    version: '0.1.54',
    permissions: ['activeTab', 'storage', 'downloads'],
    host_permissions: ['https://api.redgifs.com/*', 'https://media.redgifs.com/*', 'https://reddit.com/*', 'https://*.reddit.com/*', `${new URL(LICENSE_SITE).origin}/*`],
    browser_specific_settings: {
      gecko: {
        // Los GIF guardados quedan en local. Solo se envía al servidor de licencias el ID aleatorio de la instalación (el email se escribe en la web de canje, no en la extensión).
        data_collection_permissions: { required: ['technicalAndInteraction'] },
      },
    },
    // host_permissions: ['*://*.ejemplo.com/*'],   // sitios que la extensión puede leer o modificar
    // Solo si usas ffmpeg.wasm:
     content_security_policy: {
       extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
     },
  },
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
