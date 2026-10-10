// Comprueba la documentación: (1) enlaces relativos y anclas, (2) frescura (last_reviewed + review_every_days),
// (3) que lo generado esté al día. Sale con código 1 si hay enlaces rotos o `--strict` y hay vencidos.
// Uso: node scripts/docs/check-docs.mjs [--strict]
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const root = process.cwd();
const docs = join(root, 'docs');
const strict = process.argv.includes('--strict');
const walk = d => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : [];
});
const files = walk(docs);
const slug = h => h.toLowerCase().trim().replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
const anchors = f => new Set([...readFileSync(f, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => slug(m[1])));

let broken = 0, stale = 0;
const now = Date.now();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const rel = f.slice(root.length + 1);
  // enlaces
  const body = text.replace(/```[\s\S]*?```/g, '');
  for (const m of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = m[1];
    if (/^(https?:|mailto:)/.test(href)) continue;
    const [path, hash] = href.split('#');
    const target = path ? resolve(dirname(f), path) : f;
    if (!existsSync(target)) { console.log(`ENLACE ROTO  ${rel}: ${href}`); broken++; continue; }
    if (hash && target.endsWith('.md') && !anchors(target).has(hash)) { console.log(`ANCLA ROTA   ${rel}: ${href}`); broken++; }
  }
  // frescura
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  if (/status:\s*generated/.test(fm)) continue; // lo generado no caduca: se regenera
  const last = /last_reviewed:\s*(\d{4}-\d{2}-\d{2})/.exec(fm)?.[1];
  const every = Number(/review_every_days:\s*(\d+)/.exec(fm)?.[1] ?? 0);
  if (!last || !every) { console.log(`SIN METADATOS ${rel}`); stale++; continue; }
  const age = (now - Date.parse(last)) / 86400000;
  if (age > every) { console.log(`VENCIDO      ${rel}: revisado ${last}, cada ${every} días`); stale++; }
}
console.log(`\n${files.length} archivos · ${broken} enlaces rotos · ${stale} vencidos/sin metadatos`);
process.exit(broken || (strict && stale) ? 1 : 0);
