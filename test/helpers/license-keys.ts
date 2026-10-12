// Par ECDSA P-256 de prueba. La clave pública real de la extensión se sustituye vía vi.mock('../utils/license-config').
// vi.resetModules() reevalúa este archivo: las claves se guardan en globalThis para que no cambien entre recargas.
const g = globalThis as typeof globalThis & { __licenseKeys?: Promise<{ pair: CryptoKeyPair; other: CryptoKeyPair; jwk: JsonWebKey }> };
g.__licenseKeys ??= (async () => {
  const gen = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pair = await gen();
  return { pair, other: await gen(), jwk: await crypto.subtle.exportKey('jwk', pair.publicKey) };
})();
const { pair, other, jwk } = await g.__licenseKeys;
export const publicJwk = jwk as { kty: 'EC'; crv: 'P-256'; x: string; y: string };

export const b64url = (data: Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export interface Claims { v?: number; id: string; plan?: string; iat?: number; exp?: number; lim?: boolean }

export async function signToken(claims: Claims, key: 'good' | 'other' = 'good'): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ v: 1, plan: 'premium', iat: now, exp: now + 3600, ...claims }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, (key === 'good' ? pair : other).privateKey, new TextEncoder().encode(payload));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}
