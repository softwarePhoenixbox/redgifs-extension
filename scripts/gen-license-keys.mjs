// Genera el par de claves ECDSA P-256 para firmar licencias.
//   node scripts/gen-license-keys.mjs
// - La parte PÚBLICA se pega en utils/license-config.ts (LICENSE_PUBLIC_JWK).
// - La parte PRIVADA se guarda como secreto del servidor:
//     npx wrangler pages secret put LICENSE_PRIVATE_JWK --project-name <tu-proyecto>
//   y NO se sube a git ni se pega en la extensión.
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

console.log('=== PÚBLICA (utils/license-config.ts -> LICENSE_PUBLIC_JWK) ===');
console.log(JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, null, 2));
console.log('\n=== PRIVADA (secreto LICENSE_PRIVATE_JWK; guárdala en un gestor de contraseñas) ===');
console.log(JSON.stringify({ kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y, d: priv.d }));
