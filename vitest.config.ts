import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // Cast: vitest trae su propia copia de vite y los tipos de PluginOption no coinciden.
  plugins: [WxtVitest() as never],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Orden aleatorio: cada prueba debe ser independiente (semilla visible con --sequence.seed).
    sequence: { shuffle: true },
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['utils/**', 'premium/**', 'entrypoints/background.ts'],
      exclude: ['utils/license-config.ts'],
    },
  },
});
