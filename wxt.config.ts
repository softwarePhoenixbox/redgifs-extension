import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Mi Extension',
    version: '0.1.2',
    permissions: ['activeTab', 'storage', 'downloads'],
    host_permissions: ['https://api.redgifs.com/*', 'https://media.redgifs.com/*'],
    browser_specific_settings: {
      gecko: {
        // La extensión solo guarda los GIF elegidos localmente; no recopila ni transmite datos personales.
        data_collection_permissions: { required: ['none'] },
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
