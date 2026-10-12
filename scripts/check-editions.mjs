// Prueba de humo de los paquetes ya compilados (`pnpm build:all`): cada edición contiene solo lo que le corresponde.
// Uso: node scripts/check-editions.mjs   (sale con código 1 si algo no cumple)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LICENSE_HOST = 'redgifs-license.pages.dev';
const dirs = { basic: '.output/chrome-mv3-basic', premium: '.output/chrome-mv3-premium', activated: '.output/chrome-mv3-activated' };

function allFiles(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? allFiles(p) : [p];
  });
}
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

for (const [edition, dir] of Object.entries(dirs)) {
  if (!existsSync(dir)) { failures.push(`${edition}: falta ${dir} (¿corriste pnpm build:all?)`); continue; }
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const files = allFiles(dir);
  const js = files.filter(f => f.endsWith('.js'));
  const has = needle => js.some(f => readFileSync(f, 'utf8').includes(needle));
  const hosts = manifest.host_permissions ?? [];
  const reddit = hosts.some(h => h.includes('reddit.com'));
  const licenseHost = hosts.some(h => h.includes(LICENSE_HOST));
  const redditScript = (manifest.content_scripts ?? []).some(c => (c.matches ?? []).some(m => m.includes('reddit.com')));

  check(manifest.content_security_policy?.extension_pages?.includes("script-src 'self'"), `${edition}: CSP de extension_pages ausente o relajada`);
  // 'wasm-unsafe-eval' es necesario para sql.js/ffmpeg; 'unsafe-eval' a secas NO.
  check(!/(^|[\s;])'unsafe-eval'/.test(manifest.content_security_policy?.extension_pages ?? ''), `${edition}: CSP con 'unsafe-eval'`);
  check(!(manifest.permissions ?? []).includes('<all_urls>') && !hosts.includes('<all_urls>'), `${edition}: pide <all_urls>`);
  check(manifest.permissions?.includes('offscreen'), `${edition}: chrome debe declarar 'offscreen'`);

  if (edition === 'basic') {
    check(!has('spreadsheetml'), 'basic: contiene código del exportador xlsx (premium)');
    check(!reddit && !redditScript, 'basic: incluye Reddit');
    check(!licenseHost, 'basic: pide permiso al servidor de licencias');
    check(!files.some(f => /reddit/i.test(f)), 'basic: incluye un archivo de Reddit');
  } else {
    check(has('spreadsheetml'), `${edition}: falta el exportador xlsx`);
    check(reddit && redditScript, `${edition}: falta Reddit`);
  }
  if (edition === 'premium') check(licenseHost, 'premium: debe poder hablar con el servidor de licencias');
  if (edition === 'activated') {
    check(!licenseHost, 'activated: no debe pedir permiso al servidor de licencias');
    check(/activated/.test(manifest.name), 'activated: el nombre debe delatar que es un build personal (no publicar)');
  }
}

if (failures.length) {
  console.error('✖ Comprobación de ediciones fallida:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('✔ Las tres ediciones contienen solo lo que les corresponde');
