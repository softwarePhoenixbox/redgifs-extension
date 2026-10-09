// Licencias: plan gratuito vs premium.
//
// Modelo:
//  - Cada instalación (navegador + perfil) genera un installId aleatorio y lo
//    guarda en storage.local (NO en storage.sync: sync lo copiaría a todos los
//    perfiles de la misma cuenta de Google).
//  - El usuario canjea ese ID en la página web; el dueño lo aprueba.
//  - La extensión pregunta al servidor y recibe un token firmado (ECDSA P-256)
//    con {id, plan, exp}. Aquí solo se VERIFICA la firma; la clave privada
//    nunca está en la extensión.
//
// Límite honesto: el código de una extensión es JavaScript editable. La firma
// impide activar premium editando el storage, pero no impide parchear el código.

import { EDITION } from './edition';
import { LICENSE_PUBLIC_JWK, LICENSE_SITE } from './license-config';

const ID_KEY = 'rgInstallId';
const TOKEN_KEY = 'rgLicenseToken';
const STATUS_KEY = 'rgLicenseStatus';
const CHECKED_KEY = 'rgLicenseCheckedAt';
const METER_KEY = 'rgLicenseMeter'; // { metered: boolean, remaining: number | null }
// Bandera de solo lectura para los content scripts (decide qué opciones
// mostrar). NO es autoridad: el background siempre vuelve a verificar el token.
export const PREMIUM_FLAG_KEY = 'rgPremium';

const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const PREMIUM_REQUIRED_MESSAGE = 'Premium feature. Open the extension popup to upgrade. / Función premium: abre el popup de la extensión para activarla.';
export const BASIC_EDITION_MESSAGE = 'This feature is not included in the basic edition. / Esta función no está incluida en la edición básica.';
export const NO_CREDITS_MESSAGE = 'No premium uses left on this license. / Ya no quedan usos premium en esta licencia.';
export const NO_CONNECTION_MESSAGE = 'Could not reach the license server to confirm this use. / No se pudo contactar al servidor de licencias para confirmar este uso.';

export type LicenseStatus = 'none' | 'pending' | 'approved' | 'revoked' | 'released' | 'expired' | 'unknown';

export interface LicenseState {
  installId: string;
  premium: boolean;
  status: LicenseStatus;
  exp: number | null; // unix seconds del token actual
  checkedAt: number | null; // ms de la última consulta exitosa al servidor
  site: string;
  edition: typeof EDITION;
  metered: boolean; // la licencia tiene usos limitados
  remaining: number | null; // usos restantes (null = ilimitado o desconocido)
}

interface TokenPayload {
  v: 1;
  id: string;
  plan: 'premium';
  iat: number;
  exp: number;
  lim?: boolean; // licencia con usos limitados
}

export function licenseSite(): string {
  return LICENSE_SITE.replace(/\/+$/, '');
}

function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let publicKeyPromise: Promise<CryptoKey> | null = null;
function publicKey(): Promise<CryptoKey> {
  publicKeyPromise ??= crypto.subtle.importKey(
    'jwk',
    { ...LICENSE_PUBLIC_JWK, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return publicKeyPromise;
}

/** Devuelve el payload solo si la firma es válida, es de ESTE installId y no venció. */
export async function verifyToken(token: unknown, installId: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<TokenPayload | null> {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  try {
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await publicKey(),
      b64urlToBytes(sigB64),
      new TextEncoder().encode(payloadB64),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64))) as Partial<TokenPayload>;
    if (payload.v !== 1 || payload.plan !== 'premium') return null;
    if (payload.id !== installId) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
    return payload as TokenPayload;
  } catch {
    return null; // clave pública vacía, token corrupto, etc. => gratis
  }
}

let installIdPromise: Promise<string> | null = null;
export function getInstallId(): Promise<string> {
  installIdPromise ??= (async () => {
    const stored = await browser.storage.local.get(ID_KEY);
    const current = stored[ID_KEY];
    if (typeof current === 'string' && UUID_RE.test(current)) return current;
    const id = crypto.randomUUID();
    await browser.storage.local.set({ [ID_KEY]: id });
    return id;
  })().catch(error => {
    installIdPromise = null;
    throw error;
  });
  return installIdPromise;
}

async function setPremiumFlag(premium: boolean): Promise<void> {
  const current = await browser.storage.local.get(PREMIUM_FLAG_KEY);
  if (current[PREMIUM_FLAG_KEY] !== premium) await browser.storage.local.set({ [PREMIUM_FLAG_KEY]: premium });
}

interface Meter { metered: boolean; remaining: number | null }

async function readMeter(): Promise<Meter> {
  const stored = await browser.storage.local.get(METER_KEY);
  const m = stored[METER_KEY] as Partial<Meter> | undefined;
  return { metered: m?.metered === true, remaining: typeof m?.remaining === 'number' ? m.remaining : null };
}

/** Autoridad para el background: ¿hay un token firmado, válido y vigente? (no mira los usos) */
export async function isPremium(): Promise<boolean> {
  if (EDITION === 'basic') return false;
  if (EDITION === 'activated') return true;
  const installId = await getInstallId();
  const stored = await browser.storage.local.get(TOKEN_KEY);
  return (await verifyToken(stored[TOKEN_KEY], installId)) !== null;
}

export async function readLicense(): Promise<LicenseState> {
  const installId = await getInstallId();
  const base = { installId, site: licenseSite(), edition: EDITION };
  if (EDITION === 'basic') {
    await setPremiumFlag(false);
    return { ...base, premium: false, status: 'none', exp: null, checkedAt: null, metered: false, remaining: null };
  }
  if (EDITION === 'activated') {
    await setPremiumFlag(true);
    return { ...base, premium: true, status: 'approved', exp: null, checkedAt: null, metered: false, remaining: null };
  }
  const stored = await browser.storage.local.get([TOKEN_KEY, STATUS_KEY, CHECKED_KEY]);
  const payload = await verifyToken(stored[TOKEN_KEY], installId);
  const meter = payload ? await readMeter() : { metered: false, remaining: null };
  // Con usos agotados, el plan cuenta como no utilizable para la interfaz y los content scripts.
  await setPremiumFlag(payload !== null && !(meter.metered && meter.remaining === 0));
  const status = (payload ? 'approved' : stored[STATUS_KEY] === 'approved' ? 'expired' : stored[STATUS_KEY] ?? 'unknown') as LicenseStatus;
  return {
    ...base,
    premium: payload !== null,
    status,
    exp: payload?.exp ?? null,
    checkedAt: typeof stored[CHECKED_KEY] === 'number' ? stored[CHECKED_KEY] : null,
    metered: payload?.lim === true || meter.metered,
    remaining: meter.remaining,
  };
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(`${licenseSite()}${path}`, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Consulta el servidor (como máximo una vez cada 24 h salvo force).
 * Sin red: se conserva el token en caché hasta que venza (gracia offline).
 * Con respuesta del servidor que niega la licencia: se borra el token ya.
 * Con force=true los errores del servidor/red se lanzan para mostrarlos en el popup.
 */
export async function refreshLicense(force = false): Promise<LicenseState> {
  const before = await readLicense();
  if (EDITION !== 'premium') return before;
  if (!force && before.checkedAt !== null && Date.now() - before.checkedAt < REFRESH_AFTER_MS) return before;
  try {
    const res = await api(`/api/status?id=${encodeURIComponent(before.installId)}`);
    const body = (await res.json().catch(() => ({}))) as { status?: LicenseStatus; token?: string; metered?: boolean; remaining?: number | null; error?: string };
    if (!res.ok) {
      if (force) throw new Error(body.error ?? `server_${res.status}`);
      return before;
    }
    const status = body.status ?? 'unknown';
    const update: Record<string, unknown> = { [STATUS_KEY]: status, [CHECKED_KEY]: Date.now() };
    if (status === 'approved' && (await verifyToken(body.token, before.installId))) {
      update[TOKEN_KEY] = body.token;
      update[METER_KEY] = { metered: body.metered === true, remaining: typeof body.remaining === 'number' ? body.remaining : null };
    } else {
      await browser.storage.local.remove([TOKEN_KEY, METER_KEY]);
      // Servidor dijo "approved" pero la firma no valida: la clave pública de la extensión no es la del servidor.
      if (status === 'approved' && force) throw new Error('bad_signature');
    }
    await browser.storage.local.set(update);
  } catch (error) {
    // Los errores propios son códigos (invalid_key, server_500, bad_signature…); cualquier otro es de red.
    if (force) throw error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error : new Error('network');
    // red caída: seguimos con lo que haya en caché
  }
  return readLicense();
}

/** Activa esta instalación con una clave de licencia y descarga el token. */
export async function activateWithKey(key: string): Promise<LicenseState> {
  const installId = await getInstallId();
  let res: Response;
  try {
    res = await api('/api/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installId, key }),
    });
  } catch {
    throw new Error('network');
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `server_${res.status}`);
  return refreshLicense(true);
}

/**
 * Se llama al inicio de CADA acción premium en el background.
 *  - basic: siempre rechaza. activated: siempre permite.
 *  - premium: exige un token válido; si la licencia tiene usos limitados, descuenta 1 en el servidor
 *    (sin conexión o sin usos, la acción no se ejecuta).
 */
export async function authorizePremiumAction(): Promise<void> {
  if (EDITION === 'basic') throw new Error(BASIC_EDITION_MESSAGE);
  if (EDITION === 'activated') return;
  const installId = await getInstallId();
  const stored = await browser.storage.local.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY] as string | undefined;
  const payload = await verifyToken(token, installId);
  if (!payload || !token) throw new Error(PREMIUM_REQUIRED_MESSAGE);
  if (!payload.lim) return;

  let res: Response;
  try {
    res = await api('/api/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ installId }),
    });
  } catch {
    throw new Error(NO_CONNECTION_MESSAGE);
  }
  const body = (await res.json().catch(() => ({}))) as { remaining?: number | null; error?: string };
  if (typeof body.remaining === 'number') {
    await browser.storage.local.set({ [METER_KEY]: { metered: true, remaining: body.remaining } });
    if (body.remaining === 0) await setPremiumFlag(false);
  }
  if (res.status === 402) throw new Error(NO_CREDITS_MESSAGE);
  if (!res.ok) throw new Error(body.error === 'revoked' || body.error === 'expired' ? PREMIUM_REQUIRED_MESSAGE : NO_CONNECTION_MESSAGE);
}

/** Libera esta instalación (libera un cupo del email) y vuelve a plan gratuito. */
export async function releaseLicense(): Promise<LicenseState> {
  if (EDITION !== 'premium') return readLicense();
  const installId = await getInstallId();
  const res = await api('/api/release', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ installId }),
  });
  if (!res.ok) throw new Error(`Release failed (${res.status})`);
  await browser.storage.local.remove([TOKEN_KEY, STATUS_KEY, METER_KEY]);
  await browser.storage.local.set({ [CHECKED_KEY]: Date.now() });
  return readLicense();
}
