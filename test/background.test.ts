import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RgRequest, RgResponse } from '../utils/messages';
import { freshIndexedDb, installFetch } from './helpers/env';
import { signToken } from './helpers/license-keys';

vi.mock('../utils/license-config', async () => {
  const { publicJwk } = await import('./helpers/license-keys');
  return { LICENSE_SITE: 'https://lic.test', LICENSE_PUBLIC_JWK: publicJwk };
});

const ID = '11111111-2222-4333-8444-555555555555';
const GOOD_URL = 'https://media.redgifs.com/ZanyJudiciousRook.mp4';

type Edition = 'basic' | 'premium' | 'activated';
type Send = (m: RgRequest | { type: string; [k: string]: unknown }) => Promise<RgResponse>;
type FetchHandler = Parameters<typeof installFetch>[0];

async function boot(edition: Edition, handler?: FetchHandler): Promise<{ send: Send; fetchMock: ReturnType<typeof installFetch>; download: ReturnType<typeof vi.fn> }> {
  vi.resetModules();
  vi.stubEnv('WXT_EDITION', edition);
  fakeBrowser.reset();
  await fakeBrowser.storage.local.set({ rgInstallId: ID });
  freshIndexedDb();
  const fetchMock = installFetch(handler);
  const download = vi.fn(async () => 42);
  (fakeBrowser.downloads as unknown as { download: unknown }).download = download;
  const mod = await import('../entrypoints/background');
  mod.default.main?.();
  const send: Send = msg =>
    new Promise<RgResponse>(resolve => {
      void fakeBrowser.runtime.onMessage.trigger(msg, { id: 'ext' }, resolve);
    });
  return { send, fetchMock, download };
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
async function grantPremium(opts: { lim?: boolean } = {}) {
  await fakeBrowser.storage.local.set({ rgLicenseToken: await signToken({ id: ID, lim: opts.lim }) });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('mensajes: validación general', () => {
  it('un tipo de mensaje desconocido devuelve error, no cuelga', async () => {
    const { send } = await boot('premium');
    expect(await send({ type: 'RG_NO_EXISTE' })).toEqual({ ok: false, error: 'Mensaje desconocido' });
  });

  it('RG_STATS / RG_CHECK_LINK / RG_LIST_LINKS / RG_DELETE_LINK sobre una base vacía', async () => {
    const { send } = await boot('basic');
    expect(await send({ type: 'RG_STATS' })).toEqual({ ok: true, total: 0 });
    expect(await send({ type: 'RG_CHECK_LINK', id: 'x' })).toEqual({ ok: true, exists: false });
    expect(await send({ type: 'RG_LIST_LINKS' })).toEqual({ ok: true, links: [] });
    expect(await send({ type: 'RG_DELETE_LINK', id: 'x' })).toEqual({ ok: true, total: 0 });
  });
});

describe('RG_SAVE_LINK', () => {
  const ok = { type: 'RG_SAVE_LINK', id: 'abc', url: GOOD_URL, pageUrl: 'https://www.redgifs.com/watch/abc' } as const;

  it('guarda y luego reporta duplicado', async () => {
    const { send } = await boot('basic');
    expect(await send(ok)).toEqual({ ok: true, inserted: true, total: 1 });
    expect(await send(ok)).toEqual({ ok: true, inserted: false, total: 1 });
    expect(await send({ type: 'RG_CHECK_LINK', id: 'abc' })).toEqual({ ok: true, exists: true });
  });

  it.each([
    ['id vacío', { ...ok, id: '' }],
    ['id con caracteres peligrosos', { ...ok, id: "a'; DROP--" }],
    ['id con ruta', { ...ok, id: '../x' }],
    ['url http', { ...ok, url: 'http://media.redgifs.com/a.mp4' }],
    ['host ajeno', { ...ok, url: 'https://evil.com/a.mp4' }],
    ['sufijo engañoso', { ...ok, url: 'https://redgifs.com.evil.com/a.mp4' }],
    ['dominio que termina igual', { ...ok, url: 'https://notredgifs.com/a.mp4' }],
    ['userinfo engañoso', { ...ok, url: 'https://redgifs.com@evil.com/a.mp4' }],
    ['esquema javascript', { ...ok, url: 'javascript:alert(1)' }],
    ['url no parseable', { ...ok, url: 'esto no es url' }],
    ['imagen en host ajeno', { ...ok, imageUrl: 'https://evil.com/i.jpg' }],
  ])('rechaza %s', async (_n, msg) => {
    const { send } = await boot('basic');
    expect(await send(msg as RgRequest)).toEqual({ ok: false, error: 'Datos inválidos' });
    expect(await send({ type: 'RG_STATS' })).toEqual({ ok: true, total: 0 });
  });

  it('acepta subdominios legítimos de redgifs.com', async () => {
    const { send } = await boot('basic');
    expect((await send({ ...ok, url: 'https://thumbs2.redgifs.com/a.mp4', imageUrl: 'https://www.redgifs.com/i.jpg' })).ok).toBe(true);
  });
});

describe('RG_RESOLVE_GIF', () => {
  const gifBody = (over: object = {}) => ({
    gif: {
      urls: { hd: 'https://media.redgifs.com/a.mp4', sd: 'https://media.redgifs.com/a-mobile.mp4', thumbnail: 'https://media.redgifs.com/a-thumb.jpg' },
      title: '  Mi título ', userName: ' autor ', tags: ['uno', '#dos', ' ', ' tres '], ...over,
    },
  });
  const api = (gif: (url: string, init?: RequestInit) => Response) => (url: string, init?: RequestInit) =>
    url.endsWith('/auth/temporary') ? json({ token: 'TOK' }) : gif(url, init);

  it.each(['', '../etc', 'a b', 'a/b', 'a?x=1', 'ñandú'])('rechaza id inválido %j sin llamar a la red', async id => {
    const { send, fetchMock } = await boot('premium', api(() => json(gifBody())));
    const res = await send({ type: 'RG_RESOLVE_GIF', id });
    expect(res.ok).toBe(false);
    expect(fetchMock.mock.calls.filter(c => !String(c[0]).endsWith('.wasm'))).toHaveLength(0);
  });

  it('obtiene token temporal, lo envía como Bearer y normaliza metadatos', async () => {
    const { send, fetchMock } = await boot('premium', api(() => json(gifBody())));
    const res = await send({ type: 'RG_RESOLVE_GIF', id: 'Abc-1_x' });
    expect(res).toMatchObject({ ok: true, gif: {
      videoUrl: 'https://media.redgifs.com/a.mp4',
      hdVideoUrl: 'https://media.redgifs.com/a.mp4',
      sdVideoUrl: 'https://media.redgifs.com/a-mobile.mp4',
      imageUrl: 'https://media.redgifs.com/a-thumb.jpg',
      metadata: { title: 'Mi título', author: 'autor', tags: ['#uno', '#dos', '#tres'] },
    } });
    const gifCall = fetchMock.mock.calls.find(c => String(c[0]).includes('/gifs/'))!;
    expect(String(gifCall[0])).toBe('https://api.redgifs.com/v2/gifs/Abc-1_x?views=yes');
    expect((gifCall[1]?.headers as Record<string, string>).Authorization).toBe('Bearer TOK');
  });

  it('basic: nunca expone HD aunque la API lo devuelva', async () => {
    const { send } = await boot('basic', api(() => json(gifBody())));
    const res = await send({ type: 'RG_RESOLVE_GIF', id: 'abc' });
    expect(res).toMatchObject({ ok: true, gif: { videoUrl: 'https://media.redgifs.com/a-mobile.mp4' } });
    expect((res as { gif: object }).gif).not.toHaveProperty('hdVideoUrl');
  });

  it('descarta URLs de la API que no sean de redgifs (respuesta manipulada)', async () => {
    const { send } = await boot('premium', api(() => json(gifBody({ urls: { hd: 'https://evil.com/a.mp4', sd: 'http://media.redgifs.com/a.mp4' } }))));
    expect(await send({ type: 'RG_RESOLVE_GIF', id: 'abc' })).toEqual({ ok: true, not_found: true });
  });

  it('si la miniatura es de un host ajeno, usa el video como imagen', async () => {
    const { send } = await boot('premium', api(() => json(gifBody({ urls: { sd: 'https://media.redgifs.com/a.mp4', thumbnail: 'https://evil.com/t.jpg' } }))));
    expect(await send({ type: 'RG_RESOLVE_GIF', id: 'abc' })).toMatchObject({ gif: { imageUrl: 'https://media.redgifs.com/a.mp4' } });
  });

  it('sin miniatura: deriva -mobile.jpg del video', async () => {
    const { send } = await boot('basic', api(() => json(gifBody({ urls: { sd: 'https://media.redgifs.com/a.mp4' } }))));
    expect(await send({ type: 'RG_RESOLVE_GIF', id: 'abc' })).toMatchObject({ gif: { imageUrl: 'https://media.redgifs.com/a-mobile.jpg' } });
  });

  it('sin título: usa la primera línea de la descripción que no sea solo un hashtag', async () => {
    const { send } = await boot('premium', api(() => json(gifBody({ title: '', description: '#uno\n\n  Línea real  \nOtra' }))));
    expect(await send({ type: 'RG_RESOLVE_GIF', id: 'abc' })).toMatchObject({ gif: { metadata: { title: 'Línea real' } } });
  });

  // HALLAZGO (baja/media): el filtro /^#[\p{L}\p{N}_\s]+$/u no admite '#' dentro de la línea, así que
  // "#uno #dos #tres" (el formato habitual de hashtags) NO se descarta y pasa a ser el título, que luego se incrusta
  // en el MP4 (WM/Title). Arreglo: /^(?:#[\p{L}\p{N}_]+\s*)+$/u. Quitar `.fails` al corregirlo.
  it.fails('sin título: una línea con varios hashtags tampoco debe usarse como título', async () => {
    const { send } = await boot('premium', api(() => json(gifBody({ title: '', description: '#uno #dos\n\n  Línea real  \nOtra' }))));
    expect(await send({ type: 'RG_RESOLVE_GIF', id: 'abc' })).toMatchObject({ gif: { metadata: { title: 'Línea real' } } });
  });

  it('sin título ni descripción: título null; sin tags: arreglo vacío', async () => {
    const { send } = await boot('premium', api(() => json(gifBody({ title: undefined, userName: undefined, tags: undefined }))));
    expect(await send({ type: 'RG_RESOLVE_GIF', id: 'abc' })).toMatchObject({ gif: { metadata: { title: null, author: null, tags: [] } } });
  });

  it('404 → not_found; 429 → rate_limited; otros HTTP → error con el código', async () => {
    for (const [status, expected] of [[404, { ok: true, not_found: true }], [429, { ok: true, rate_limited: true }]] as const) {
      const { send } = await boot('premium', api(() => json({}, status)));
      expect(await send({ type: 'RG_RESOLVE_GIF', id: 'abc' })).toEqual(expected);
    }
    const { send } = await boot('premium', api(() => new Response('upstream <b>down</b>', { status: 503 })));
    const res = await send({ type: 'RG_RESOLVE_GIF', id: 'abc' });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain('HTTP 503');
  });

  it('401 renueva el token y reintenta UNA vez (sin bucle)', async () => {
    let gifCalls = 0;
    let authCalls = 0;
    const { send } = await boot('premium', (url, init) => {
      if (url.endsWith('/auth/temporary')) return json({ token: `T${++authCalls}` });
      gifCalls++;
      return (init?.headers as Record<string, string>).Authorization === 'Bearer T2' ? json(gifBody()) : json({}, 401);
    });
    expect((await send({ type: 'RG_RESOLVE_GIF', id: 'abc' })).ok).toBe(true);
    expect(authCalls).toBe(2);
    expect(gifCalls).toBe(2);
  });

  it('401 persistente: no reintenta más de una vez', async () => {
    let gifCalls = 0;
    const { send } = await boot('premium', url => url.endsWith('/auth/temporary') ? json({ token: 'T' }) : (gifCalls++, json({}, 401)));
    expect((await send({ type: 'RG_RESOLVE_GIF', id: 'abc' })).ok).toBe(false);
    expect(gifCalls).toBe(2);
  });

  it('el token se reutiliza entre llamadas (una sola autenticación)', async () => {
    let authCalls = 0;
    const { send } = await boot('premium', url => url.endsWith('/auth/temporary') ? (authCalls++, json({ token: 'T' })) : json(gifBody()));
    await send({ type: 'RG_RESOLVE_GIF', id: 'a' });
    await send({ type: 'RG_RESOLVE_GIF', id: 'b' });
    expect(authCalls).toBe(1);
  });

  it('falla de red o auth sin token → mensaje amigable, sin filtrar detalles internos', async () => {
    const { send } = await boot('premium', () => { throw new TypeError('Failed to fetch'); });
    expect(await send({ type: 'RG_RESOLVE_GIF', id: 'abc' })).toEqual({ ok: false, error: expect.stringContaining('No se pudo conectar') });
    const b = await boot('premium', url => url.endsWith('/auth/temporary') ? json({}) : json(gifBody()));
    expect((await b.send({ type: 'RG_RESOLVE_GIF', id: 'abc' })).ok).toBe(false);
  });
});

describe('RG_DOWNLOAD: validación y puertas de plan', () => {
  const dl = (over: object = {}) => ({ type: 'RG_DOWNLOAD', id: 'ZanyJudiciousRook', url: GOOD_URL, quality: 'sd', ...over }) as RgRequest;

  it.each([
    ['id inválido', dl({ id: 'a b' })],
    ['host ajeno', dl({ url: 'https://evil.com/a.mp4' })],
    ['http', dl({ url: 'http://media.redgifs.com/a.mp4' })],
  ])('rechaza %s', async (_n, msg) => {
    const { send, download } = await boot('activated');
    expect(await send(msg)).toEqual({ ok: false, error: 'Datos inválidos' });
    expect(download).not.toHaveBeenCalled();
  });

  it('basic: solo SD; HD, imagen y calidad omitida se rechazan', async () => {
    const { send, download } = await boot('basic');
    for (const quality of ['hd', 'image', undefined]) {
      expect(await send(dl({ quality }))).toEqual({ ok: false, error: 'Not available in the basic edition' });
    }
    expect(download).not.toHaveBeenCalled();
    expect((await send(dl())).ok).toBe(true);
  });

  it('premium sin licencia: SD sí; HD / imagen / calidad omitida (= hd) exigen premium', async () => {
    const { send, download } = await boot('premium');
    for (const quality of ['hd', 'image', undefined]) {
      const res = await send(dl({ quality }));
      expect(res).toMatchObject({ ok: false, error: expect.stringContaining('Premium feature') });
    }
    expect(download).not.toHaveBeenCalled();
    expect((await send(dl())).ok).toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('premium con licencia válida: HD permitido', async () => {
    const { send, download } = await boot('premium');
    await grantPremium();
    expect((await send(dl({ quality: 'hd' }))).ok).toBe(true);
    expect(download).toHaveBeenCalled();
  });

  it('licencia con usos limitados: cada descarga HD consume 1; SD no consume', async () => {
    const { send, fetchMock } = await boot('premium', url => url.endsWith('/api/consume') ? json({ remaining: 3 }) : new Response('', { status: 404 }));
    await grantPremium({ lim: true });
    await send(dl({ quality: 'sd' }));
    expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('/api/consume'))).toHaveLength(0);
    await send(dl({ quality: 'hd' }));
    expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('/api/consume'))).toHaveLength(1);
  });

  it('licencia sin usos: la descarga HD no se ejecuta', async () => {
    const { send, download } = await boot('premium', url => url.endsWith('/api/consume') ? json({ remaining: 0 }, 402) : new Response('', { status: 404 }));
    await grantPremium({ lim: true });
    expect(await send(dl({ quality: 'hd' }))).toMatchObject({ ok: false, error: expect.stringContaining('No premium uses left') });
    expect(download).not.toHaveBeenCalled();
  });

  it('token de OTRA instalación copiado al storage no desbloquea premium', async () => {
    const { send, download } = await boot('premium');
    await fakeBrowser.storage.local.set({ rgLicenseToken: await signToken({ id: 'otra-instalacion' }) });
    expect((await send(dl({ quality: 'hd' }))).ok).toBe(false);
    expect(download).not.toHaveBeenCalled();
  });

  describe('nombre de archivo', () => {
    const nameOf = async (msg: object, edition: Edition = 'activated') => {
      const { send, download } = await boot(edition);
      await send({ ...dl(), ...msg } as RgRequest);
      return (download.mock.calls[0] as unknown as [{ filename: string }])[0].filename;
    };
    it('usa el nombre canónico de la URL del medio', async () => expect(await nameOf({})).toBe('redgifs/ZanyJudiciousRook.mp4'));
    it('añade -sd cuando el nombre de la URL no es válido', async () => expect(await nameOf({ url: 'https://media.redgifs.com/x/y/%E2%82%AC' })).toBe('redgifs/ZanyJudiciousRook-sd.mp4'));
    it('imagen premium: sufijo -image', async () => expect(await nameOf({ quality: 'image', url: 'https://media.redgifs.com/a/%20.jpg' })).toBe('redgifs/ZanyJudiciousRook-image.jpg'));
    it('acepta un nombre pedido solo si es seguro', async () => {
      expect(await nameOf({ filename: 'mi-video_1.mp4' })).toBe('redgifs/mi-video_1.mp4');
      expect(await nameOf({ filename: '../../evil.mp4' })).toBe('redgifs/ZanyJudiciousRook.mp4');
      expect(await nameOf({ filename: 'a/b.mp4' })).toBe('redgifs/ZanyJudiciousRook.mp4');
      expect(await nameOf({ filename: 'x.exe' })).toBe('redgifs/ZanyJudiciousRook.mp4');
    });
    it('useOriginalFilename=false genera un nombre aleatorio con la extensión correcta', async () => {
      const a = await nameOf({ useOriginalFilename: false });
      expect(a).toMatch(/^redgifs\/[0-9a-f-]{36}\.mp4$/);
      expect(await nameOf({ useOriginalFilename: false })).not.toBe(a);
    });
    it('nunca sale de la carpeta redgifs/ (sin ..)', async () => {
      const n = await nameOf({ url: 'https://media.redgifs.com/..%2F..%2Fx.mp4' });
      expect(n.startsWith('redgifs/')).toBe(true);
      expect(n).not.toContain('..');
    });
  });

  describe('metadatos y reintentos', () => {
    it('sin metadatos: descarga el original y avisa', async () => {
      const { send, download } = await boot('activated');
      const res = await send(dl());
      expect(res).toMatchObject({ ok: true, downloadId: 42, metadata_embedded: false });
      expect(download).toHaveBeenCalledWith(expect.objectContaining({ url: GOOD_URL, conflictAction: 'uniquify', saveAs: false }));
    });

    it('formato que no es mp4: descarga sin incrustar', async () => {
      const { send } = await boot('activated');
      const res = await send(dl({ url: 'https://media.redgifs.com/a.webm', title: 'T' }));
      expect(res).toMatchObject({ ok: true, metadata_embedded: false, metadata_warning: expect.stringContaining('webm') });
    });

    it('si el MP4 descargado es inválido, cae a la descarga original sin metadatos (no pierde el video)', async () => {
      const { send, download } = await boot('activated', url => url === GOOD_URL ? new Response(new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4])) : new Response('', { status: 404 }));
      const res = await send(dl({ title: 'T' }));
      expect(res).toMatchObject({ ok: true, metadata_embedded: false, metadata_warning: expect.stringContaining('No se pudieron incrustar') });
      expect(download).toHaveBeenLastCalledWith(expect.objectContaining({ url: GOOD_URL }));
    });

    it('con un MP4 válido incrusta metadatos y descarga el blob', async () => {
      const { buildMp4 } = await import('./helpers/mp4');
      const { send, download } = await boot('activated', url => url === GOOD_URL ? new Response(new Blob([buildMp4().bytes as BlobPart])) : new Response('', { status: 404 }));
      const res = await send(dl({ title: 'T', author: 'A' }));
      expect(res).toMatchObject({ ok: true, metadata_embedded: true });
      expect(String((download.mock.calls[0] as unknown as [{ url: string }])[0].url)).toMatch(/^blob:/);
    });

    it('reintenta la descarga con backoff y entrega el error real si siempre falla', async () => {
      vi.useFakeTimers();
      try {
        const { send, download } = await boot('activated');
        download.mockRejectedValue(new Error('USER_CANCELED'));
        const p = send(dl());
        await vi.advanceTimersByTimeAsync(500 + 1000 + 10);
        expect(await p).toEqual({ ok: false, error: 'USER_CANCELED' });
        expect(download).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('se recupera si un reintento posterior funciona', async () => {
      vi.useFakeTimers();
      try {
        const { send, download } = await boot('activated');
        download.mockRejectedValueOnce(new Error('transitorio')).mockResolvedValue(7);
        const p = send(dl());
        await vi.advanceTimersByTimeAsync(600);
        expect(await p).toMatchObject({ ok: true, downloadId: 7 });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('funciones premium: puertas de edición (RG_SAVE_BULK, RG_EXPORT_DB, RG_DOWNLOAD_ALL, RG_DOWNLOAD_FRAME)', () => {
  const bulk = (links: object[]) => ({ type: 'RG_SAVE_BULK', links }) as RgRequest;
  const good = { id: 'a', url: GOOD_URL, pageUrl: 'https://www.redgifs.com/watch/a' };
  const gated: Array<[string, RgRequest]> = [
    ['RG_SAVE_BULK', bulk([good])],
    ['RG_EXPORT_DB', { type: 'RG_EXPORT_DB', format: 'html' }],
    ['RG_DOWNLOAD_ALL', { type: 'RG_DOWNLOAD_ALL' }],
    ['RG_DOWNLOAD_FRAME', { type: 'RG_DOWNLOAD_FRAME', id: 'a', base64: 'AAAA' }],
  ];

  it.each(gated)('basic rechaza %s', async (_n, msg) => {
    const { send } = await boot('basic');
    expect(await send(msg)).toEqual({ ok: false, error: 'Not available in the basic edition' });
    expect(await send({ type: 'RG_STATS' })).toEqual({ ok: true, total: 0 });
  });

  it.each(gated)('premium sin licencia rechaza %s', async (_n, msg) => {
    const { send } = await boot('premium');
    expect(await send(msg)).toMatchObject({ ok: false, error: expect.stringContaining('Premium feature') });
    expect(await send({ type: 'RG_STATS' })).toEqual({ ok: true, total: 0 });
  });

  it('activated: guardado en lote filtra entradas inválidas y cuenta insertados/actualizados', async () => {
    const { send } = await boot('activated');
    const res = await send(bulk([
      good,
      { ...good, id: 'b' },
      { ...good, id: 'bad id' },
      { ...good, id: 'c', url: 'https://evil.com/c.mp4' },
      { ...good, id: 'd', imageUrl: 'https://evil.com/d.jpg' },
      good, // duplicado → actualización
    ]));
    expect(res).toEqual({ ok: true, inserted_count: 2, updated_count: 1, total: 2 });
  });

  it('activated: exportar en cada formato devuelve archivo con el mime correcto', async () => {
    const { send } = await boot('activated');
    await send(bulk([good]));
    const mimes: Record<string, string> = {
      sqlite: 'application/vnd.sqlite3',
      db: 'application/octet-stream',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      html: 'text/html;charset=utf-8',
    };
    for (const [format, mime] of Object.entries(mimes)) {
      const res = await send({ type: 'RG_EXPORT_DB', format, language: 'es' });
      expect(res, format).toMatchObject({ ok: true, mime, filename: expect.stringContaining('redgifs-links.') });
      expect((res as { base64: string }).base64.length).toBeGreaterThan(10);
    }
    expect(await send({ type: 'RG_EXPORT_DB', format: 'pdf' })).toEqual({ ok: false, error: 'Formato desconocido' });
  });

  it('activated: descargar todo cuenta en cola, fallidos y sin metadatos', async () => {
    const { send, download } = await boot('activated');
    await send(bulk([good, { ...good, id: 'b', url: 'https://media.redgifs.com/b.mp4' }]));
    download.mockResolvedValueOnce(1).mockRejectedValue(new Error('x'));
    vi.useFakeTimers();
    try {
      const p = send({ type: 'RG_DOWNLOAD_ALL' });
      await vi.advanceTimersByTimeAsync(5000);
      const res = await p;
      expect(res).toMatchObject({ ok: true, queued: 1, failed: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('RG_DOWNLOAD_FRAME valida el base64 y el id', async () => {
    const { send, download } = await boot('activated');
    expect(await send({ type: 'RG_DOWNLOAD_FRAME', id: 'a b', base64: 'AAAA' })).toMatchObject({ ok: false, error: 'Datos del fotograma inválidos' });
    expect(await send({ type: 'RG_DOWNLOAD_FRAME', id: 'a', base64: 'no*base64!' })).toMatchObject({ ok: false, error: 'Datos del fotograma inválidos' });
    expect(download).not.toHaveBeenCalled();
    const ok = await send({ type: 'RG_DOWNLOAD_FRAME', id: 'a', base64: btoa('jpegbytes'), filename: 'a-frame.jpg' });
    expect(ok).toMatchObject({ ok: true, downloadId: 42 });
    expect((download.mock.calls[0] as unknown as [{ filename: string }])[0].filename).toBe('redgifs/a-frame.jpg');
  });
});

describe('RG_IMPORT_DB', () => {
  it('base64 corrupto o archivo inválido devuelven error y no rompen la base', async () => {
    const { send } = await boot('basic');
    expect((await send({ type: 'RG_IMPORT_DB', base64: '%%%no%%%' })).ok).toBe(false);
    expect(await send({ type: 'RG_IMPORT_DB', base64: btoa('texto plano') })).toMatchObject({ ok: false });
    expect(await send({ type: 'RG_STATS' })).toEqual({ ok: true, total: 0 });
  });

  it('importa un export válido (también en la edición básica)', async () => {
    const a = await boot('activated');
    await a.send({ type: 'RG_SAVE_LINK', id: 'a', url: GOOD_URL, pageUrl: 'https://www.redgifs.com/watch/a' });
    const exp = await a.send({ type: 'RG_EXPORT_DB', format: 'sqlite' }) as { base64: string };
    const b = await boot('basic');
    expect(await b.send({ type: 'RG_IMPORT_DB', base64: exp.base64 })).toEqual({ ok: true, imported: 1, updated: 0, total: 1 });
  });
});

describe('licencia vía mensajes', () => {
  it('RG_LICENSE_GET en premium sin token: gratis; en basic: edición basic', async () => {
    const p = await boot('premium', () => json({ status: 'none' }));
    expect(await p.send({ type: 'RG_LICENSE_GET' })).toMatchObject({ ok: true, license: { premium: false, edition: 'premium', installId: ID } });
    const b = await boot('basic');
    expect(await b.send({ type: 'RG_LICENSE_GET', refresh: true })).toMatchObject({ ok: true, license: { premium: false, edition: 'basic' } });
  });

  it('RG_LICENSE_ACTIVATE propaga el código de error del servidor al popup', async () => {
    const { send } = await boot('premium', () => json({ error: 'invalid_key' }, 400));
    expect(await send({ type: 'RG_LICENSE_ACTIVATE', key: 'mala' })).toEqual({ ok: false, error: 'invalid_key' });
  });
});

describe('arranque y mensajes de menú de Reddit', () => {
  it('crea el installId en el arranque', async () => {
    vi.resetModules();
    vi.stubEnv('WXT_EDITION', 'premium');
    fakeBrowser.reset();
    installFetch();
    freshIndexedDb();
    const mod = await import('../entrypoints/background');
    mod.default.main?.();
    await vi.waitFor(async () => expect((await fakeBrowser.storage.local.get('rgInstallId')).rgInstallId).toMatch(/^[0-9a-f-]{36}$/));
  });

  it('RG_REDDIT_MENU_OPEN desde el marco principal (frameId 0) o sin pestaña se rechaza', async () => {
    const { send } = await boot('premium');
    const trigger = (msg: object, sender: object) => new Promise<RgResponse>(resolve => { void fakeBrowser.runtime.onMessage.trigger(msg, sender, resolve); });
    const m = { type: 'RG_REDDIT_MENU_OPEN', requestId: 'r1', gifId: 'g', choices: ['sd'] };
    expect(await trigger(m, { id: 'ext', frameId: 0, tab: { id: 1 } })).toMatchObject({ ok: false });
    expect(await trigger(m, { id: 'ext', frameId: 3 })).toMatchObject({ ok: false });
    void send;
  });

  it('RG_REDDIT_MENU_SELECTED con un requestId desconocido o de otra pestaña se rechaza (anti-suplantación)', async () => {
    await boot('premium');
    const trigger = (msg: object, sender: object) => new Promise<RgResponse>(resolve => { void fakeBrowser.runtime.onMessage.trigger(msg, sender, resolve); });
    expect(await trigger({ type: 'RG_REDDIT_MENU_SELECTED', requestId: 'nope', choice: 'sd' }, { id: 'ext', frameId: 0, tab: { id: 1 } })).toMatchObject({ ok: false, error: expect.stringContaining('ya no está disponible') });
  });

  it('basic ignora los mensajes de menú de Reddit (no existe ese código)', async () => {
    const { send } = await boot('basic');
    expect(await send({ type: 'RG_REDDIT_MENU_OPEN', requestId: 'r', gifId: 'g', choices: ['sd'] })).toEqual({ ok: false, error: 'Mensaje desconocido' });
  });
});
