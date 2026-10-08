// Configuración de licencias. Se edita UNA vez antes de publicar.
//
// 1. LICENSE_SITE: URL de tu proyecto en Cloudflare Pages (sin "/" final).
// 2. LICENSE_PUBLIC_JWK: clave PÚBLICA que imprime `node scripts/gen-license-keys.mjs`.
//    La privada va solo como secreto del servidor (LICENSE_PRIVATE_JWK), nunca aquí.
//
// Mientras la clave pública esté vacía, ninguna licencia valida y todos los
// usuarios quedan en el plan gratuito (falla cerrado).
export const LICENSE_SITE = 'https://redgifs-license.pages.dev';

export const LICENSE_PUBLIC_JWK: { kty: 'EC'; crv: 'P-256'; x: string; y: string } = {
  kty: 'EC',
  crv: 'P-256',
  x: '6Zp7EqNdPJuYj_4rwYv_fTPP2jIDrUugcEgJibuo240',
  y: 'QCVsaO-QZUSo0k2Cf_UAwVInJkD3foLJl38kZOTYz74',
};