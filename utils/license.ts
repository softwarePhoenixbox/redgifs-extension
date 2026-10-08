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

import { LICENSE_PUBLIC_JWK, LICENSE_SITE } from './license-config';

const ID_KEY = 'rgInstallId';
const TOKEN_KEY = 'rgLicenseToken';
const STATUS_KEY = 'rgLicenseStatus';
const CHECKED_KEY = 'rgLicenseCheckedAt';
// Bandera de solo lectura para los content scripts (decide qué opciones
// mostrar). NO es autoridad: el background siempre vuelve a verificar el token.
export const PREMIUM_FLAG_KEY = 'rgPremium';

const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const PREMIUM_REQUIRED_MESSAGE = 'Premium feature. Open the extension popup to upgrade. / Función premium: abre el popup de la extensión para activarla.';

export type LicenseStatus = 'none' | 'pending' | 'approved' | 'revoked' | 'released' | 'expired' | 'unknown';

export interface LicenseState {
  installId: string;
  premium: boolean;
  status: LicenseStatus;
  exp: number | null; // unix seconds del token actual
  checkedAt: number | null; // ms de la última consulta exitosa al servidor
  site: string;
}

interface TokenPayload {
  v: 1;
  id: string;
  plan: 'premium';
  iat: number;
  exp: number;
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

/** Autoridad para el background: ¿hay un token firmado, válido y vigente? */
export async function isPremium(): Promise<boolean> {
  const installId = await getInstallId();
  const stored = await browser.storage.local.get(TOKEN_KEY);
  const ok = (await verifyToken(stored[TOKEN_KEY], installId)) !== null;
  await setPremiumFlag(ok);
  return ok;
}

export async function readLicense(): Promise<LicenseState> {
  const installId = await getInstallId();
  const stored = await browser.storage.local.get([TOKEN_KEY, STATUS_KEY, CHECKED_KEY]);
  const payload = await verifyToken(stored[TOKEN_KEY], installId);
  await setPremiumFlag(payload !== null);
  const status = (payload ? 'approved' : stored[STATUS_KEY] === 'approved' ? 'expired' : stored[STATUS_KEY] ?? 'unknown') as LicenseStatus;
  return {
    installId,
    premium: payload !== null,
    status,
    exp: payload?.exp ?? null,
    checkedAt: typeof stored[CHECKED_KEY] === 'number' ? stored[CHECKED_KEY] : null,
    site: licenseSite(),
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
 */
export async function refreshLicense(force = false): Promise<LicenseState> {
  const before = await readLicense();
  if (!force && before.checkedAt !== null && Date.now() - before.checkedAt < REFRESH_AFTER_MS) return before;
  try {
    const res = await api(`/api/status?id=${encodeURIComponent(before.installId)}`);
    if (!res.ok) return before;
    const body = (await res.json()) as { status?: LicenseStatus; token?: string };
    const status = body.status ?? 'unknown';
    const update: Record<string, unknown> = { [STATUS_KEY]: status, [CHECKED_KEY]: Date.now() };
    if (status === 'approved' && (await verifyToken(body.token, before.installId))) {
      update[TOKEN_KEY] = body.token;
    } else {
      await browser.storage.local.remove(TOKEN_KEY);
    }
    await browser.storage.local.set(update);
  } catch {
    // red caída: seguimos con lo que haya en caché
  }
  return readLicense();
}

/** Libera esta instalación (libera un cupo del email) y vuelve a plan gratuito. */
export async function releaseLicense(): Promise<LicenseState> {
  const installId = await getInstallId();
  const res = await api('/api/release', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ installId }),
  });
  if (!res.ok) throw new Error(`Release failed (${res.status})`);
  await browser.storage.local.remove([TOKEN_KEY, STATUS_KEY]);
  await browser.storage.local.set({ [CHECKED_KEY]: Date.now() });
  return readLicense();
}
