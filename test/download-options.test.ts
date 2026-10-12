import { afterEach, describe, expect, it, vi } from 'vitest';

type Mod = typeof import('../utils/download-options');
async function load(edition: 'basic' | 'premium' | 'activated'): Promise<Mod> {
  vi.resetModules();
  vi.stubEnv('WXT_EDITION', edition);
  return import('../utils/download-options');
}
afterEach(() => vi.unstubAllEnvs());

const ALL = { hd: true, sd: true, image: true, frame: true };

describe('normalizeDownloadOptions', () => {
  it('basic: ignora cualquier valor guardado y devuelve solo SD', async () => {
    const m = await load('basic');
    expect(m.normalizeDownloadOptions(ALL)).toEqual({ sd: true });
    expect(m.normalizeDownloadOptions(undefined, 'both')).toEqual({ sd: true });
  });

  it('objeto guardado: solo cuenta true estricto (no truthy)', async () => {
    const m = await load('premium');
    expect(m.normalizeDownloadOptions({ hd: 1, sd: 'true', image: true, frame: null })).toEqual({ hd: false, sd: false, image: true, frame: false });
  });

  it('migra la preferencia antigua de calidad', async () => {
    const m = await load('premium');
    expect(m.normalizeDownloadOptions(undefined, 'sd')).toEqual({ hd: false, sd: true, image: false, frame: false });
    expect(m.normalizeDownloadOptions(undefined, 'both')).toEqual({ hd: true, sd: true, image: false, frame: false });
    expect(m.normalizeDownloadOptions(undefined, 'hd')).toEqual(m.DEFAULT_DOWNLOAD_OPTIONS);
    expect(m.normalizeDownloadOptions(undefined)).toEqual({ hd: true, sd: false, image: false, frame: false });
  });

  it('null o tipos raros caen al valor por defecto, no lanzan', async () => {
    const m = await load('premium');
    expect(m.normalizeDownloadOptions(null)).toEqual(m.DEFAULT_DOWNLOAD_OPTIONS);
    expect(m.normalizeDownloadOptions('hd')).toEqual(m.DEFAULT_DOWNLOAD_OPTIONS);
  });

  it('un objeto vacío significa "nada activado" (el popup avisa con noDownloadOptions)', async () => {
    const m = await load('premium');
    expect(m.enabledDownloadChoices(m.normalizeDownloadOptions({}))).toEqual([]);
  });
});

describe('effectiveDownloadOptions (puerta del plan gratuito)', () => {
  it('sin premium: fuerza SD aunque el usuario tenga todo activado', async () => {
    const m = await load('premium');
    expect(m.effectiveDownloadOptions(ALL, false)).toEqual({ hd: false, sd: true, image: false, frame: false });
  });
  it('con premium: respeta las opciones', async () => {
    const m = await load('premium');
    expect(m.effectiveDownloadOptions(ALL, true)).toEqual(ALL);
  });
  it('basic: SD aunque premium=true', async () => {
    const m = await load('basic');
    expect(m.effectiveDownloadOptions(ALL, true)).toEqual({ sd: true });
  });
  // HALLAZGO (latente, baja gravedad): se devuelve la constante compartida FREE_DOWNLOAD_OPTIONS (y SD_ONLY /
  // DEFAULT_DOWNLOAD_OPTIONS en normalize). Si algún llamador la muta, todos los usuarios gratuitos obtienen HD.
  // Hoy nadie la muta. `it.fails`: cuando se devuelvan copias (o se congelen con Object.freeze) este test pasará
  // y habrá que quitar `.fails`.
  it.fails('devuelve copias y no la constante compartida del plan gratuito', async () => {
    const m = await load('premium');
    const a = m.effectiveDownloadOptions(ALL, false);
    a.hd = true;
    expect(m.effectiveDownloadOptions(ALL, false).hd).toBe(false);
  });
});

describe('enabledDownloadChoices', () => {
  it('mantiene el orden hd, sd, image, frame', async () => {
    const m = await load('premium');
    expect(m.enabledDownloadChoices({ hd: false, sd: true, image: true, frame: true })).toEqual(['sd', 'image', 'frame']);
    expect(m.enabledDownloadChoices(ALL)).toEqual(['hd', 'sd', 'image', 'frame']);
  });
  it('basic: solo sd', async () => {
    const m = await load('basic');
    expect(m.enabledDownloadChoices({ sd: true } as never)).toEqual(['sd']);
    expect(m.enabledDownloadChoices({ sd: false } as never)).toEqual([]);
  });
});
