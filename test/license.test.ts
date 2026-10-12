import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { b64url, publicJwk, signToken } from './helpers/license-keys';

vi.mock('../utils/license-config', async () => {
  const { publicJwk } = await import('./helpers/license-keys');
  return { LICENSE_SITE: 'https://lic.test/', LICENSE_PUBLIC_JWK: publicJwk };
});

const ID = '11111111-2222-4333-8444-555555555555';
const now = () => Math.floor(Date.now() / 1000);

type License = typeof import('../utils/license');
async function load(edition?: 'basic' | 'activated' | 'premium'): Promise<License> {
  vi.resetModules();
  if (edition) vi.stubEnv('WXT_EDITION', edition);
  return import('../utils/license');
}
const store = (data: Record<string, unknown>) => fakeBrowser.storage.local.set(data);
const read = (k: string) => fakeBrowser.storage.local.get(k).then(r => r[k]);

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn((url: string, init?: RequestInit) => Promise.resolve(impl(url, init)));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  fakeBrowser.reset();
  await store({ rgInstallId: ID });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('verifyToken', () => {
  it('acepta un token firmado, del mismo installId y vigente', async () => {
    const { verifyToken } = await load();
    const p = await verifyToken(await signToken({ id: ID }), ID);
    expect(p).toMatchObject({ id: ID, plan: 'premium' });
  });

  it('rechaza un token de otro installId (copiar el token a otra instalación no sirve)', async () => {
    const { verifyToken } = await load();
    expect(await verifyToken(await signToken({ id: 'otro' }), ID)).toBeNull();
  });

  it('rechaza tokens vencidos y el borde exp == ahora', async () => {
    const { verifyToken } = await load();
    const n = now();
    expect(await verifyToken(await signToken({ id: ID, exp: n - 1 }), ID, n)).toBeNull();
    expect(await verifyToken(await signToken({ id: ID, exp: n }), ID, n)).toBeNull();
    expect(await verifyToken(await signToken({ id: ID, exp: n + 1 }), ID, n)).not.toBeNull();
  });

  it('rechaza firmas de otra clave (servidor equivocado / token forjado)', async () => {
    const { verifyToken } = await load();
    expect(await verifyToken(await signToken({ id: ID }, 'other'), ID)).toBeNull();
  });

  it('rechaza si se edita el payload sin refirmar (p. ej. quitar el límite de usos)', async () => {
    const { verifyToken } = await load();
    const token = await signToken({ id: ID, lim: true });
    const [, sig] = token.split('.');
    const forged = `${b64url(JSON.stringify({ v: 1, id: ID, plan: 'premium', iat: 0, exp: now() + 99999 }))}.${sig}`;
    expect(await verifyToken(forged, ID)).toBeNull();
  });

  it.each([
    ['no es string', 123],
    ['null', null],
    ['vacío', ''],
    ['sin punto', 'abc'],
    ['tres partes', 'a.b.c'],
    ['partes vacías', '.'],
    ['base64 basura', '@@@.@@@'],
  ])('rechaza entrada malformada: %s', async (_n, input) => {
    const { verifyToken } = await load();
    expect(await verifyToken(input, ID)).toBeNull();
  });

  it('rechaza versión o plan desconocidos aunque la firma sea válida', async () => {
    const { verifyToken } = await load();
    expect(await verifyToken(await signToken({ id: ID, v: 2 }), ID)).toBeNull();
    expect(await verifyToken(await signToken({ id: ID, plan: 'enterprise' }), ID)).toBeNull();
    expect(await verifyToken(await signToken({ id: ID, exp: 'nunca' as unknown as number }), ID)).toBeNull();
  });
});

describe('getInstallId', () => {
  it('genera y persiste un UUID cuando no existe', async () => {
    await fakeBrowser.storage.local.clear();
    const { getInstallId } = await load();
    const id = await getInstallId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await read('rgInstallId')).toBe(id);
  });

  it('reutiliza el existente y reemplaza valores corruptos', async () => {
    const { getInstallId } = await load();
    expect(await getInstallId()).toBe(ID);
    await store({ rgInstallId: 'no-es-uuid' });
    const fresh = await load();
    expect(await fresh.getInstallId()).not.toBe('no-es-uuid');
  });

  it('llamadas concurrentes devuelven el mismo id (sin carrera)', async () => {
    await fakeBrowser.storage.local.clear();
    const { getInstallId } = await load();
    const ids = await Promise.all(Array.from({ length: 20 }, () => getInstallId()));
    expect(new Set(ids).size).toBe(1);
  });
});

describe('edición basic / activated', () => {
  it('basic: nunca premium y rechaza acciones premium', async () => {
    const l = await load('basic');
    expect(await l.isPremium()).toBe(false);
    await expect(l.authorizePremiumAction()).rejects.toThrow(l.BASIC_EDITION_MESSAGE);
    const s = await l.readLicense();
    expect(s).toMatchObject({ premium: false, status: 'none', edition: 'basic' });
    expect(await read('rgPremium')).toBe(false);
  });

  it('basic: un token válido en storage no activa premium', async () => {
    await store({ rgLicenseToken: await signToken({ id: ID }) });
    const l = await load('basic');
    expect(await l.isPremium()).toBe(false);
  });

  it('activated: siempre premium y sin red', async () => {
    const f = mockFetch(() => json({}));
    const l = await load('activated');
    expect(await l.isPremium()).toBe(true);
    await expect(l.authorizePremiumAction()).resolves.toBeUndefined();
    expect(await l.refreshLicense(true)).toMatchObject({ premium: true, status: 'approved' });
    expect(f).not.toHaveBeenCalled();
    expect(await read('rgPremium')).toBe(true);
  });
});

describe('readLicense / isPremium (edición premium)', () => {
  it('sin token: gratis, estado "unknown" y bandera apagada', async () => {
    const l = await load('premium');
    expect(await l.isPremium()).toBe(false);
    expect(await l.readLicense()).toMatchObject({ premium: false, status: 'unknown', installId: ID, site: 'https://lic.test' });
    expect(await read('rgPremium')).toBe(false);
  });

  it('token válido: premium, estado approved y exp expuesto', async () => {
    const exp = now() + 500;
    await store({ rgLicenseToken: await signToken({ id: ID, exp }) });
    const l = await load('premium');
    expect(await l.isPremium()).toBe(true);
    expect(await l.readLicense()).toMatchObject({ premium: true, status: 'approved', exp });
    expect(await read('rgPremium')).toBe(true);
  });

  it('token vencido tras haber sido aprobado → "expired" y gratis', async () => {
    await store({ rgLicenseToken: await signToken({ id: ID, exp: now() - 10 }), rgLicenseStatus: 'approved' });
    const l = await load('premium');
    expect(await l.readLicense()).toMatchObject({ premium: false, status: 'expired' });
  });

  it('editar el storage para poner status=approved sin token válido NO da premium', async () => {
    await store({ rgLicenseStatus: 'approved', rgPremium: true, rgLicenseToken: 'falso.falso' });
    const l = await load('premium');
    expect(await l.isPremium()).toBe(false);
    expect((await l.readLicense()).premium).toBe(false);
    expect(await read('rgPremium')).toBe(false); // la bandera se corrige sola
  });

  it('usos agotados: la bandera de UI se apaga pero la licencia sigue vigente', async () => {
    await store({ rgLicenseToken: await signToken({ id: ID, lim: true }), rgLicenseMeter: { metered: true, remaining: 0 } });
    const l = await load('premium');
    const s = await l.readLicense();
    expect(s).toMatchObject({ premium: true, metered: true, remaining: 0 });
    expect(await read('rgPremium')).toBe(false);
  });
});

describe('authorizePremiumAction (edición premium)', () => {
  it('sin token: rechaza', async () => {
    const l = await load('premium');
    await expect(l.authorizePremiumAction()).rejects.toThrow(l.PREMIUM_REQUIRED_MESSAGE);
  });

  it('token ilimitado: permite sin llamar al servidor', async () => {
    await store({ rgLicenseToken: await signToken({ id: ID }) });
    const f = mockFetch(() => json({}));
    const l = await load('premium');
    await expect(l.authorizePremiumAction()).resolves.toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  describe('licencia con usos limitados', () => {
    let token: string;
    beforeEach(async () => {
      token = await signToken({ id: ID, lim: true });
      await store({ rgLicenseToken: token });
    });

    it('descuenta 1 uso en el servidor con Bearer y guarda lo que queda', async () => {
      const f = mockFetch(() => json({ remaining: 4 }));
      const l = await load('premium');
      await l.authorizePremiumAction();
      const [url, init] = f.mock.calls[0]!;
      expect(url).toBe('https://lic.test/api/consume');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
      expect(JSON.parse(String(init?.body))).toEqual({ installId: ID });
      expect(await read('rgLicenseMeter')).toEqual({ metered: true, remaining: 4 });
    });

    it('último uso consumido (remaining 0) permite la acción pero apaga la bandera', async () => {
      mockFetch(() => json({ remaining: 0 }));
      const l = await load('premium');
      await expect(l.authorizePremiumAction()).resolves.toBeUndefined();
      expect(await read('rgPremium')).toBe(false);
    });

    it('402 → sin usos; no ejecuta la acción', async () => {
      mockFetch(() => json({ remaining: 0, error: 'no_credits' }, 402));
      const l = await load('premium');
      await expect(l.authorizePremiumAction()).rejects.toThrow(l.NO_CREDITS_MESSAGE);
    });

    it('sin red: falla CERRADO (no regala el uso)', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
      const l = await load('premium');
      await expect(l.authorizePremiumAction()).rejects.toThrow(l.NO_CONNECTION_MESSAGE);
    });

    it('revoked/expired del servidor → mensaje de premium requerido', async () => {
      mockFetch(() => json({ error: 'revoked' }, 403));
      const l = await load('premium');
      await expect(l.authorizePremiumAction()).rejects.toThrow(l.PREMIUM_REQUIRED_MESSAGE);
    });

    it('500 del servidor → sin conexión (no permite la acción)', async () => {
      mockFetch(() => json({ error: 'boom' }, 500));
      const l = await load('premium');
      await expect(l.authorizePremiumAction()).rejects.toThrow(l.NO_CONNECTION_MESSAGE);
    });

    it('respuesta 200 con cuerpo no JSON no rompe (se trata como OK sin contador)', async () => {
      mockFetch(() => new Response('<html>', { status: 200 }));
      const l = await load('premium');
      await expect(l.authorizePremiumAction()).resolves.toBeUndefined();
    });
  });
});

describe('refreshLicense', () => {
  it('no consulta al servidor si se verificó hace menos de 24 h (sin force)', async () => {
    await store({ rgLicenseCheckedAt: Date.now() - 1000 });
    const f = mockFetch(() => json({}));
    const l = await load('premium');
    await l.refreshLicense(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('consulta pasadas 24 h, y con force siempre', async () => {
    await store({ rgLicenseCheckedAt: Date.now() - 25 * 3600_000 });
    const f = mockFetch(() => json({ status: 'pending' }));
    const l = await load('premium');
    await l.refreshLicense(false);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe(`https://lic.test/api/status?id=${ID}`);
    await l.refreshLicense(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('approved con token válido: guarda token, contador y estado', async () => {
    const token = await signToken({ id: ID, lim: true });
    mockFetch(() => json({ status: 'approved', token, metered: true, remaining: 7 }));
    const l = await load('premium');
    const s = await l.refreshLicense(true);
    expect(s).toMatchObject({ premium: true, status: 'approved', metered: true, remaining: 7 });
    expect(await read('rgLicenseToken')).toBe(token);
  });

  it('approved con firma inválida: borra el token y con force avisa bad_signature', async () => {
    await store({ rgLicenseToken: await signToken({ id: ID }) });
    mockFetch(() => json({ status: 'approved', token: await_bad() }));
    const l = await load('premium');
    await expect(l.refreshLicense(true)).rejects.toThrow('bad_signature');
    expect(await read('rgLicenseToken')).toBeUndefined();
  });

  it('el servidor niega (revoked): borra el token de inmediato', async () => {
    await store({ rgLicenseToken: await signToken({ id: ID }), rgLicenseMeter: { metered: true, remaining: 3 } });
    mockFetch(() => json({ status: 'revoked' }));
    const l = await load('premium');
    const s = await l.refreshLicense(true);
    expect(s).toMatchObject({ premium: false, status: 'revoked' });
    expect(await read('rgLicenseToken')).toBeUndefined();
    expect(await read('rgLicenseMeter')).toBeUndefined();
  });

  it('sin red y sin force: conserva el token en caché (gracia offline)', async () => {
    await store({ rgLicenseToken: await signToken({ id: ID }) });
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const l = await load('premium');
    expect((await l.refreshLicense(false)).premium).toBe(true);
  });

  it('sin red con force: error "network"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const l = await load('premium');
    await expect(l.refreshLicense(true)).rejects.toThrow('network');
  });

  it('error HTTP con force: propaga el código del servidor; sin force lo ignora', async () => {
    mockFetch(() => json({ error: 'invalid_key' }, 400));
    const l = await load('premium');
    await expect(l.refreshLicense(true)).rejects.toThrow('invalid_key');
    await expect(l.refreshLicense(false)).resolves.toBeDefined();
    mockFetch(() => new Response('', { status: 503 }));
    await expect(l.refreshLicense(true)).rejects.toThrow('server_503');
  });

  it('un mensaje de error del servidor que no sea un código se oculta como "network"', async () => {
    mockFetch(() => json({ error: 'Texto Libre con <html>' }, 400));
    const l = await load('premium');
    await expect(l.refreshLicense(true)).rejects.toThrow('network');
  });

  it('timeout: aborta el fetch pasados 8 s', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise((_r, rej) => signal?.addEventListener('abort', () => rej(new DOMException('This operation was aborted', 'AbortError'))));
      }));
      const l = await load('premium');
      const p = l.refreshLicense(true);
      const assertion = expect(p).rejects.toThrow('network');
      await vi.advanceTimersByTimeAsync(8000);
      await assertion;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('activateWithKey / releaseLicense', () => {
  it('activa: POST /api/activate y luego refresca estado', async () => {
    const token = await signToken({ id: ID });
    const f = mockFetch(url => url.endsWith('/api/activate') ? json({ ok: true }) : json({ status: 'approved', token }));
    const l = await load('premium');
    const s = await l.activateWithKey('AAAA-BBBB-CCCC');
    expect(JSON.parse(String(f.mock.calls[0]![1]?.body))).toEqual({ installId: ID, key: 'AAAA-BBBB-CCCC' });
    expect(s.premium).toBe(true);
  });

  it.each([
    ['clave inválida', 400, { error: 'invalid_key' }, 'invalid_key'],
    ['sin cupo', 409, { error: 'activation_limit' }, 'activation_limit'],
    ['sin cuerpo', 500, null, 'server_500'],
  ])('error del servidor: %s', async (_n, status, body, code) => {
    mockFetch(() => body ? json(body, status) : new Response('', { status }));
    const l = await load('premium');
    await expect(l.activateWithKey('x')).rejects.toThrow(code);
  });

  it('error de red al activar → "network"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const l = await load('premium');
    await expect(l.activateWithKey('x')).rejects.toThrow('network');
  });

  it('release: borra token/estado/contador y vuelve a gratis', async () => {
    await store({ rgLicenseToken: await signToken({ id: ID }), rgLicenseStatus: 'approved', rgLicenseMeter: { metered: true, remaining: 1 } });
    mockFetch(() => json({ ok: true }));
    const l = await load('premium');
    const s = await l.releaseLicense();
    expect(s.premium).toBe(false);
    expect(await read('rgLicenseToken')).toBeUndefined();
    expect(await read('rgLicenseStatus')).toBeUndefined();
  });

  it('release fallido NO borra el token local', async () => {
    const token = await signToken({ id: ID });
    await store({ rgLicenseToken: token });
    mockFetch(() => new Response('', { status: 500 }));
    const l = await load('premium');
    await expect(l.releaseLicense()).rejects.toThrow('Release failed (500)');
    expect(await read('rgLicenseToken')).toBe(token);
  });
});

// Token con firma de la clave equivocada pero estructura válida.
function await_bad(): string {
  return `${b64url(JSON.stringify({ v: 1, id: ID, plan: 'premium', exp: now() + 999 }))}.${b64url(new Uint8Array(64))}`;
}
void publicJwk;
