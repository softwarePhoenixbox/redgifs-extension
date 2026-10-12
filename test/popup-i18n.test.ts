import { afterEach, describe, expect, it, vi } from 'vitest';

type Mod = typeof import('../utils/popup-i18n');
async function load(edition: 'basic' | 'premium'): Promise<Mod> {
  vi.resetModules();
  vi.stubEnv('WXT_EDITION', edition);
  return import('../utils/popup-i18n');
}
afterEach(() => vi.unstubAllEnvs());

describe('popupMessage', () => {
  it('interpola {valores} y deja visible el marcador si falta el dato', async () => {
    const { popupMessage } = await load('premium');
    expect(popupMessage('es', 'total', { count: 3 })).toBe('3 total');
    expect(popupMessage('en', 'exported', { filename: 'a.xlsx' })).toBe('✔ Exported: a.xlsx');
    expect(popupMessage('en', 'total')).toBe('{count} total');
  });

  it('acepta 0 como valor (no lo confunde con ausente)', async () => {
    const { popupMessage } = await load('premium');
    expect(popupMessage('en', 'savedCount', { count: 0 })).toBe('Saved: 0');
  });

  it('reemplaza todas las apariciones y no interpreta $ especiales', async () => {
    const { popupMessage } = await load('premium');
    expect(popupMessage('en', 'importResult', { imported: '$&', updated: '$1' })).toBe('✔ $& new, $1 updated');
  });

  it('paridad en/es: mismas claves y mismos marcadores {x} en ambos idiomas', async () => {
    // Se compara a través de la API pública sobre las claves reales leyendo el fuente.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../utils/popup-i18n.ts', import.meta.url), 'utf8');
    const grab = (lang: 'en' | 'es') => {
      const start = src.indexOf(`  ${lang}: {`);
      const end = src.indexOf('\n  },', start);
      const block = src.slice(start, end);
      const entries = new Map<string, string>();
      for (const m of block.matchAll(/\b(\w+):\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g)) {
        entries.set(m[1]!, m[2] ?? m[3] ?? m[4] ?? '');
      }
      return entries;
    };
    const en = grab('en');
    const es = grab('es');
    expect(en.size).toBeGreaterThan(100);
    expect([...en.keys()].sort()).toEqual([...es.keys()].sort());
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    for (const [k, v] of en) expect(ph(es.get(k)!), `marcadores de "${k}"`).toEqual(ph(v));
  });

  it('basic: las claves premium no existen en el paquete; se devuelve la clave en vez de lanzar', async () => {
    const { popupMessage } = await load('basic');
    expect(popupMessage('en', 'downloadHd')).toBe('downloadHd');
    expect(popupMessage('en', 'savedLinks')).toBe('Saved links');
  });

  it('premium: incluye los textos HD/JPG/fotograma en ambos idiomas', async () => {
    const { popupMessage } = await load('premium');
    expect(popupMessage('en', 'downloadHd')).toBe('HD video');
    expect(popupMessage('es', 'downloadHd')).toBe('Video HD');
  });
});
