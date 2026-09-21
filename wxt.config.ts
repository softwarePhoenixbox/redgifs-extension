import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Mi Extension',
    version: '0.0.1',
    permissions: ['activeTab', 'storage', 'downloads'],
    host_permissions: ['*://media.redgifs.com/*'],
    // host_permissions: ['*://*.ejemplo.com/*'],   // sitios que la extensión puede leer o modificar
    // Solo si usas ffmpeg.wasm:
     content_security_policy: {
       extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
     },
  },
});