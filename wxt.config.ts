import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Mi Extension',
    version: '0.0.1',
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
});
