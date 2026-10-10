// Genera docs/06-dependencies/index.md y docs/00-overview/tech-stack.md a partir de
// package.json + pnpm-lock.yaml (+ node_modules si está instalado, para licencias).
// Uso: node scripts/docs/gen-deps.mjs [--root <dir>] [--out <dir-docs>]
// Sin dependencias externas. No requiere red.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const root = arg('--root', process.cwd());
const out = arg('--out', join(root, 'docs'));

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');

// pnpm-lock.yaml de este repo contiene DOS documentos YAML concatenados: el primero solo
// fija pnpm (packageManagerDependencies); el segundo es el lock real. Tomamos el último "importers:".
const lastImporters = lock.lastIndexOf('\nimporters:');
const real = lock.slice(lastImporters);
const importerBlock = real.slice(real.indexOf('\n  .:'), real.indexOf('\npackages:'));

function resolvedFromImporter(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const m = new RegExp(`\\n      '?${esc}'?:\\n        specifier: [^\\n]+\\n        version: ([^\\s(]+)`).exec(importerBlock);
  return m ? m[1] : null;
}
function resolvedFromPackages(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const m = new RegExp(`\\n  '?${esc}@(\\d[^':(\\s]*)'?:\\n`).exec(real);
  return m ? m[1] : null;
}
function license(name) {
  const p = join(root, 'node_modules', name, 'package.json');
  if (!existsSync(p)) return 'n/d';
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return typeof j.license === 'string' ? j.license : j.license?.type ?? 'n/d';
}
function usage(name) {
  // Uso real: el nombre aparece en algún import de código fuente (aproximado).
  const files = ['entrypoints', 'utils', 'premium', 'stubs', 'scripts', 'wxt.config.ts'];
  return files; // placeholder para tipar; la búsqueda real se hace abajo
}
import { readdirSync, statSync } from 'node:fs';
function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|mjs|js)$/.test(f)) acc.push(p);
  }
  return acc;
}
const sources = [...usage().flatMap(d => (d.endsWith('.ts') ? (existsSync(join(root, d)) ? [join(root, d)] : []) : walk(join(root, d))))];
const sourceText = sources.map(f => ({ f: f.slice(root.length + 1), t: readFileSync(f, 'utf8') }));
function usedIn(name) {
  const re = new RegExp(`from\\s+['"]${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?:/[^'"]*)?['"]`);
  const hits = sourceText.filter(s => re.test(s.t)).map(s => s.f);
  return hits;
}
const used = name => {
  const h = usedIn(name);
  return h.length ? h.map(x => `\`${x}\``).join(', ') : '— (sin import directo)';
};

const rows = [];
for (const [kind, label] of [['dependencies', 'prod'], ['devDependencies', 'dev']]) {
  for (const [name, range] of Object.entries(pkg[kind] ?? {})) {
    rows.push({ name, label, range, resolved: resolvedFromImporter(name) ?? '?', lic: license(name), where: label === 'prod' ? used(name) : 'herramienta de build/tipos' });
  }
}

const header = (title, desc) => `---
title: ${title}
owner: pendiente-de-confirmar
status: generated
sources:
  - package.json
  - pnpm-lock.yaml
---

> GENERADO por \`scripts/docs/gen-deps.mjs\`. No editar a mano: ejecuta \`node scripts/docs/gen-deps.mjs\`.

${desc}
`;

mkdirSync(join(out, '06-dependencies'), { recursive: true });
mkdirSync(join(out, '00-overview'), { recursive: true });

const table = rows
  .map(r => `| \`${r.name}\` | ${r.label} | \`${r.range}\` | \`${r.resolved}\` | ${r.lic} | ${r.where} |`)
  .join('\n');

writeFileSync(
  join(out, '06-dependencies', 'index.md'),
  `${header('Índice de dependencias', 'Rango declarado (package.json) frente a versión resuelta (pnpm-lock.yaml). La columna «Uso» busca imports en el código fuente y es aproximada. «n/d» = no instalado en el momento de generar (ejecuta `pnpm install` antes).')}
| Paquete | Tipo | Rango declarado | Versión resuelta | Licencia | Uso |
| --- | --- | --- | --- | --- | --- |
${table}

Total: ${rows.length} dependencias directas (${rows.filter(r => r.label === 'prod').length} de producción).
`,
);

const vite = resolvedFromPackages('vite');
const sharp = resolvedFromImporter('sharp');
writeFileSync(
  join(out, '00-overview', 'tech-stack.md'),
  `${header('Stack tecnológico', 'Versiones resueltas desde el lockfile. Fuente de cada fila entre paréntesis.')}
| Capa | Tecnología | Versión | Fuente |
| --- | --- | --- | --- |
| Gestor de paquetes | pnpm | \`${pkg.packageManager.split('@')[1]}\` (campo \`packageManager\`) | \`package.json\` |
| Framework de extensiones | WXT | \`${resolvedFromImporter('wxt')}\` | \`pnpm-lock.yaml\` |
| Bundler (transitivo de WXT) | Vite | \`${vite ?? 'n/d'}\` | \`pnpm-lock.yaml\` |
| Lenguaje | TypeScript | \`${resolvedFromImporter('typescript')}\` | \`pnpm-lock.yaml\` |
| UI del popup | React / React DOM | \`${resolvedFromImporter('react')}\` | \`pnpm-lock.yaml\` |
| Base de datos local | sql.js (SQLite en WASM) | \`${resolvedFromImporter('sql.js')}\` | \`pnpm-lock.yaml\` |
| Exportación XLSX (premium) | fflate | \`${resolvedFromImporter('fflate')}\` | \`pnpm-lock.yaml\` |
| Iconos | @wxt-dev/auto-icons / sharp | \`${resolvedFromImporter('@wxt-dev/auto-icons')}\` / \`${sharp}\` | \`pnpm-lock.yaml\` |
| Ejecución y lint en Firefox | web-ext | \`${resolvedFromImporter('web-ext')}\` | \`pnpm-lock.yaml\` |
| Versión de la extensión | ${pkg.version} | \`${pkg.version}\` | \`package.json\`, \`wxt.config.ts\` |

Runtime de Node para compilar: no declarado en el repo (sin \`engines\` ni \`.nvmrc\`). Ver [pendientes](../README.md#pendiente-de-confirmar).
`,
);
console.log(`OK: ${rows.length} dependencias → ${out}`);
