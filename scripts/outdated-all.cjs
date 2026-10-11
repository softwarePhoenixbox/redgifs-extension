#!/usr/bin/env node
/**
 * outdated-all.cjs — auditoría completa de dependencias (directas y transitivas) para pnpm.
 *
 * `pnpm outdated` solo revisa las directas. Este script revisa TODO el árbol instalado y
 * cruza: versión actual vs última, vulnerabilidades (pnpm audit), deprecaciones, patches,
 * ámbito prod/dev, quién trae cada paquete, rango permitido, licencia, tamaño, etc.
 *
 * USO (desde la raíz del proyecto):
 *   node scripts/outdated-all.cjs [opciones]
 *
 * SELECCIÓN
 *   (sin opciones)         solo filas con "señal": versión nueva, deprecada o vulnerable
 *   --all                  todas las instaladas
 *   --prod | --dev         solo dependencias de producción / de desarrollo
 *   --direct | --transitive
 *   --only-vulnerable      solo con avisos de seguridad (incluye los ignorados)
 *   --only-deprecated      solo deprecadas
 *   --only-outdated        solo con versión más nueva
 *   --only-patched         solo con patch de pnpm aplicado
 *   --severity=high        umbral mínimo de severidad (info|low|moderate|high|critical)
 *   --name=<glob>          filtra por nombre, ej. --name=@babel/*  o  --name=eslint*
 *
 * COLUMNAS
 *   --detail               añade: rango, instalable, copias, fechas, edad, atraso, licencia,
 *                          tamaño, install-script, avisos, motivo de deprecación, repo
 *                          (descarga el paquete completo del registro: más lento la 1.ª vez)
 *   --cols=a,b,c           elige columnas (ver lista abajo)
 *   --group                agrupa por la dependencia directa que trae cada paquete
 *   --sort=name|change|vuln|age
 *
 * SALIDA
 *   --json | --csv         formato máquina (sin truncar textos)
 *   --no-color
 *
 * CONTROL (CI)
 *   --fail-on=<lista>      sale con código 1 si ocurre alguna, separadas por coma:
 *                            vulnerable         avisos sin ignorar (con --severity=high solo altos+)
 *                            deprecated         cualquier deprecada
 *                            deprecated-direct  deprecada que sea dependencia directa
 *                            outdated-direct    directa con versión más nueva
 *                            patch-broken       patch registrado pero no aplicado
 *
 * OTROS
 *   --no-audit             no ejecuta pnpm audit (más rápido, sin columna de vulnerabilidades)
 *   --no-cache             ignora la caché del registro (1 h, en node_modules/.cache/)
 *   --registry=<url>       registro alternativo (por defecto https://registry.npmjs.org)
 *   --cwd=<dir>            proyecto a analizar (por defecto el directorio actual)
 *   --help
 *
 * COLUMNAS DISPONIBLES (--cols=...):
 *   name current latest change type scope patch vuln state via
 *   range installable copies published latestPublished age lag license size
 *   installScript advisories deprecation repo
 *
 * Requisitos: Node 18+, pnpm en el PATH. Solo lee: no modifica el proyecto.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/* ───────────────────────────── CLI ───────────────────────────── */
const flags = new Set();
const opts = {};
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const [k, ...v] = a.slice(2).split('=');
  if (v.length) opts[k] = v.join('=');
  else flags.add(k);
}
if (flags.has('help') || flags.has('h')) {
  const src = fs.readFileSync(__filename, 'utf8');
  console.log(src.slice(src.indexOf('/**') + 4, src.indexOf('*/')).replace(/^ \* ?/gm, ''));
  process.exit(0);
}
if (typeof fetch !== 'function') {
  console.error('Se necesita Node 18 o superior (fetch integrado).');
  process.exit(2);
}

const cwd = path.resolve(opts.cwd || process.cwd());
const REGISTRY = (opts.registry || 'https://registry.npmjs.org').replace(/\/$/, '');
const DETAIL = flags.has('detail');
const useColor = !flags.has('no-color') && !process.env.NO_COLOR && process.stdout.isTTY;
const CONCURRENCY = 12;
const SEV = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const minSev = opts.severity ? SEV[opts.severity] : 0;
if (opts.severity && minSev === undefined) {
  console.error(`--severity inválida: ${opts.severity}`);
  process.exit(2);
}

/* ─────────────────────────── utilidades ─────────────────────────── */
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const C = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => C(31, s), yellow = (s) => C(33, s), green = (s) => C(32, s), cyan = (s) => C(36, s), dim = (s) => C(2, s);

function runPnpm(args) {
  return spawnSync(`pnpm ${args}`, { cwd, shell: true, encoding: 'utf8', maxBuffer: 1 << 29 });
}

/* ─────────────────────── mini-semver (sin dependencias) ─────────────────────── */
const VER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const pv = (s) => { const m = VER.exec(String(s).trim()); return m ? [+m[1], +m[2], +m[3], m[4] || ''] : null; };
const cmpv = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const isX = (s) => s === undefined || /^[xX*]$/.test(s);

function comparators(tok) {
  tok = tok.trim();
  if (!tok || /^(\*|x|X|latest)$/.test(tok)) return [];
  const m = /^(\^|~>?|>=|<=|>|<|=)?v?(\d+|[xX*])?(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(tok);
  if (!m) return null;
  const op = m[1] || '';
  if (isX(m[2])) return [];
  const maj = +m[2];
  const min = isX(m[3]) ? null : +m[3];
  const pat = isX(m[4]) ? null : +m[4];
  const lo = [maj, min ?? 0, pat ?? 0];
  switch (op) {
    case '': case '=':
      if (min === null) return [['>=', [maj, 0, 0]], ['<', [maj + 1, 0, 0]]];
      if (pat === null) return [['>=', [maj, min, 0]], ['<', [maj, min + 1, 0]]];
      return [['=', lo]];
    case '^':
      if (min === null) return [['>=', [maj, 0, 0]], ['<', [maj + 1, 0, 0]]];
      if (pat === null) return [['>=', lo], ['<', maj > 0 ? [maj + 1, 0, 0] : [0, min + 1, 0]]];
      if (maj > 0) return [['>=', lo], ['<', [maj + 1, 0, 0]]];
      if (min > 0) return [['>=', lo], ['<', [0, min + 1, 0]]];
      return [['>=', lo], ['<', [0, 0, pat + 1]]];
    case '~': case '~>':
      if (min === null) return [['>=', [maj, 0, 0]], ['<', [maj + 1, 0, 0]]];
      return [['>=', lo], ['<', [maj, min + 1, 0]]];
    case '>=': return [['>=', lo]];
    case '>':
      if (min === null) return [['>=', [maj + 1, 0, 0]]];
      if (pat === null) return [['>=', [maj, min + 1, 0]]];
      return [['>', lo]];
    case '<': return [['<', lo]];
    case '<=':
      if (min === null) return [['<', [maj + 1, 0, 0]]];
      if (pat === null) return [['<', [maj, min + 1, 0]]];
      return [['<=', lo]];
    default: return null;
  }
}
/** true / false / null (no se pudo interpretar el rango: alias npm:, git, workspace:, etc.) */
function satisfies(version, range) {
  const v = pv(version);
  if (!v || v[3] || typeof range !== 'string') return null;
  range = range.trim().replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, '$1').replace(/(\S+)\s+-\s+(\S+)/g, '>=$1 <=$2');
  for (const set of range.split('||')) {
    const comps = [];
    for (const t of set.trim().split(/\s+/).filter(Boolean)) {
      const c = comparators(t);
      if (c === null) return null;
      comps.push(...c);
    }
    const ok = comps.every(([op, w]) => {
      const d = cmpv(v, w);
      return op === '=' ? d === 0 : op === '>=' ? d >= 0 : op === '>' ? d > 0 : op === '<' ? d < 0 : d <= 0;
    });
    if (ok) return true;
  }
  return false;
}
if (process.env.OUTDATED_ALL_SELFTEST) { module.exports = { satisfies }; return; }

const changeKind = (cur, lat) => {
  const a = pv(cur), b = pv(lat);
  if (!a || !b || cmpv(a, b) >= 0) return '';
  return a[0] !== b[0] ? 'MAJOR' : a[1] !== b[1] ? 'minor' : 'patch';
};

/* ─────────────────────── 1. árbol instalado ─────────────────────── */
const rootPkg = readJson(path.join(cwd, 'package.json'));
if (!rootPkg) { console.error(`No hay package.json en ${cwd}`); process.exit(2); }

const list = runPnpm('list --depth Infinity --json');
let tree;
try { tree = JSON.parse(list.stdout); } catch {
  console.error('No pude leer el árbol con `pnpm list`. ¿Hiciste pnpm install?\n' + (list.stderr || '').slice(0, 400));
  process.exit(2);
}

const nodes = new Map(); // "nombre@versión" -> nodo
const roots = [];        // dependencias directas
const expanded = new Set();
const keyOf = (n, v) => `${n}@${v}`;
const SKIP = /^(link|file|workspace|portal):/;

function visit(name, info, parentKey) {
  if (!info || !info.version || SKIP.test(info.version)) return null;
  const key = keyOf(name, info.version);
  let node = nodes.get(key);
  if (!node) { node = { key, name, version: info.version, children: new Set(), parents: new Set(), patched: false, via: new Set(), scopes: new Set() }; nodes.set(key, node); }
  if (/_patch_hash/.test(info.path || '')) node.patched = true;
  if (parentKey) { node.parents.add(parentKey); nodes.get(parentKey).children.add(key); }
  const id = info.path || key;
  if (!expanded.has(id)) {
    expanded.add(id);
    for (const grp of ['dependencies', 'optionalDependencies']) {
      for (const [n, i] of Object.entries(info[grp] || {})) visit(n, i, key);
    }
  }
  return key;
}
for (const top of tree) {
  for (const [grp, scope] of [['dependencies', 'prod'], ['optionalDependencies', 'prod'], ['devDependencies', 'dev']]) {
    for (const [name, info] of Object.entries(top[grp] || {})) {
      const key = visit(name, info, null);
      if (key) roots.push({ name, key, scope, range: (rootPkg[grp] || {})[name] || (rootPkg.dependencies || {})[name] || (rootPkg.devDependencies || {})[name] || '' });
    }
  }
}
// atribución: qué directa trae a cada paquete y en qué ámbito
for (const r of roots) {
  const seen = new Set([r.key]);
  const stack = [r.key];
  while (stack.length) {
    const k = stack.pop();
    const n = nodes.get(k);
    n.via.add(r.name);
    n.scopes.add(r.scope);
    for (const c of n.children) if (!seen.has(c)) { seen.add(c); stack.push(c); }
  }
}
const directNames = new Set(roots.map((r) => r.name));
const copies = new Map();
for (const n of nodes.values()) copies.set(n.name, (copies.get(n.name) || 0) + 1);

/* ─────────────────────── 2. registro de npm (con caché) ─────────────────────── */
const cacheFile = path.join(cwd, 'node_modules', '.cache', 'outdated-all.json');
const cacheOn = !flags.has('no-cache');
let cache = (cacheOn && readJson(cacheFile)) || { v: 2, entries: {} };
if (cache.v !== 2) cache = { v: 2, entries: {} };
const TTL = 60 * 60 * 1000;

const needed = new Map(); // nombre -> Set(versiones instaladas)
for (const n of nodes.values()) { if (!needed.has(n.name)) needed.set(n.name, new Set()); needed.get(n.name).add(n.version); }

function extract(p) {
  const data = { latest: p['dist-tags']?.latest || null, repo: '', latestTime: p.time?.[p['dist-tags']?.latest] || null, versions: {} };
  const repo = p.repository;
  data.repo = (typeof repo === 'string' ? repo : repo?.url || '').replace(/^git\+/, '').replace(/\.git$/, '');
  for (const [v, m] of Object.entries(p.versions || {})) {
    data.versions[v] = {
      deprecated: m.deprecated || '',
      deps: { ...(m.peerDependencies || {}), ...(m.optionalDependencies || {}), ...(m.dependencies || {}) },
      license: typeof m.license === 'string' ? m.license : m.license?.type || (Array.isArray(m.licenses) ? m.licenses.map((l) => l.type).join(' OR ') : ''),
      size: m.dist?.unpackedSize ?? null,
      installScript: !!(m.hasInstallScript || m.scripts?.install || m.scripts?.preinstall || m.scripts?.postinstall),
      time: p.time?.[v] || null,
    };
  }
  return data;
}
function slim(data, versions) { // solo las versiones instaladas, para que la caché sea pequeña
  const out = { ...data, versions: {} };
  for (const v of versions) if (data.versions[v]) out.versions[v] = data.versions[v];
  return out;
}
async function fetchOne(name) {
  const want = needed.get(name);
  const hit = cache.entries[name];
  if (hit && Date.now() - hit.at < TTL && (hit.detail || !DETAIL) && (hit.missing || [...want].every((v) => hit.data.versions[v]))) return;
  const url = `${REGISTRY}/${name.replace('/', '%2f')}`;
  const headers = DETAIL ? { accept: 'application/json' } : { accept: 'application/vnd.npm.install-v1+json' };
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
      if (r.status === 404) { cache.entries[name] = { at: Date.now(), detail: DETAIL, missing: true, data: { latest: null, versions: {} } }; return; }
      if (r.ok) { cache.entries[name] = { at: Date.now(), detail: DETAIL, data: slim(extract(await r.json()), want) }; return; }
    } catch { /* reintento */ }
  }
  cache.entries[name] = { at: Date.now(), detail: DETAIL, missing: true, failed: true, data: { latest: null, versions: {} } };
}

/* ─────────────────────── 3. vulnerabilidades ─────────────────────── */
const ignored = new Set();
{
  const ws = readText(path.join(cwd, 'pnpm-workspace.yaml')).split(/\r?\n/);
  for (let i = 0; i < ws.length; i++) {
    if (/^\s*ignoreGhsas\s*:/.test(ws[i])) {
      for (let j = i + 1; j < ws.length && /^\s*-\s*/.test(ws[j]); j++) ignored.add(ws[j].replace(/^\s*-\s*/, '').replace(/["'\s]/g, ''));
    }
  }
  for (const g of rootPkg.pnpm?.auditConfig?.ignoreGhsas || []) ignored.add(g);
}
const vulnMap = new Map(); // "nombre@versión" -> [{ghsa, severity, title, patched, url, ignored}]
let auditStatus = 'ok';
async function loadAudit() {
  if (flags.has('no-audit')) { auditStatus = 'omitido'; return; }
  // --ignore-workspace: devuelve los avisos aunque estén en ignoreGhsas; el ignorado lo marcamos nosotros
  const r = runPnpm('audit --json --ignore-workspace');
  let j;
  try { j = JSON.parse(r.stdout); } catch { auditStatus = 'falló (¿sin conexión?)'; return; }
  for (const adv of Object.values(j.advisories || {})) {
    for (const f of adv.findings || []) {
      const k = keyOf(adv.module_name, f.version);
      if (!vulnMap.has(k)) vulnMap.set(k, []);
      vulnMap.get(k).push({ ghsa: adv.github_advisory_id, severity: adv.severity, title: adv.title, patched: adv.patched_versions, url: adv.url, ignored: ignored.has(adv.github_advisory_id) });
    }
  }
}

/* ─────────────────────── 4. patches registrados ─────────────────────── */
const registeredPatches = [];
{
  const ws = readText(path.join(cwd, 'pnpm-workspace.yaml')).split(/\r?\n/);
  const start = ws.findIndex((l) => /^patchedDependencies\s*:/.test(l));
  if (start >= 0) {
    for (let i = start + 1; i < ws.length && (/^\s+/.test(ws[i]) || ws[i] === ''); i++) {
      const m = /^\s+["']?(.+?)["']?\s*:\s*(\S.*?)\s*$/.exec(ws[i]);
      if (m) registeredPatches.push(m[1]);
    }
  }
  for (const k of Object.keys(rootPkg.pnpm?.patchedDependencies || {})) if (!registeredPatches.includes(k)) registeredPatches.push(k);
}
const splitSpec = (s) => { const i = s.lastIndexOf('@'); return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, '']; };
const patchSpecs = registeredPatches.map(splitSpec);

/* ─────────────────────── 5. ejecutar y construir filas ─────────────────────── */
(async () => {
  const queue = [...needed.keys()];
  await Promise.all([
    loadAudit(),
    ...Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await fetchOne(queue.shift()); }),
  ]);
  if (cacheOn) {
    try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch { /* sin caché */ }
  }
  const reg = (name) => cache.entries[name]?.data;

  const rows = [];
  for (const n of nodes.values()) {
    const data = reg(n.name);
    const meta = data?.versions?.[n.version];
    const latest = data?.latest || '?';
    const direct = directNames.has(n.name);
    // rangos que permiten esta versión: lo que declara cada padre (o package.json si es directa)
    const ranges = new Set();
    if (direct) for (const r of roots) if (r.name === n.name && r.range) ranges.add(r.range);
    for (const pk of n.parents) {
      const p = nodes.get(pk);
      const rg = reg(p.name)?.versions?.[p.version]?.deps?.[n.name];
      if (rg) ranges.add(rg);
    }
    let installable = '?';
    if (latest !== '?' && ranges.size) {
      const res = [...ranges].map((r) => satisfies(latest, r));
      installable = res.includes(false) ? 'no' : res.every((x) => x === true) ? 'sí' : '?';
    } else if (latest !== '?' && !ranges.size) installable = direct ? '?' : '?';
    const vulns = vulnMap.get(n.key) || [];
    const active = vulns.filter((v) => !v.ignored);
    const pool = active.length ? active : vulns;
    const top = pool.slice().sort((a, b) => SEV[b.severity] - SEV[a.severity])[0];
    const age = meta?.time ? Math.floor((Date.now() - Date.parse(meta.time)) / 864e5) : null;
    const lag = meta?.time && data?.latestTime ? Math.max(0, Math.floor((Date.parse(data.latestTime) - Date.parse(meta.time)) / 864e5)) : null;
    const spec = patchSpecs.find(([nm, ver]) => nm === n.name && (!ver || ver === n.version));
    rows.push({
      name: n.name, current: n.version, latest, change: changeKind(n.version, latest),
      type: direct ? 'directa' : 'transitiva', scope: n.scopes.has('prod') ? 'prod' : 'dev',
      patch: n.patched ? 'sí' : spec ? 'NO APLICADO' : '',
      vulnSeverity: top ? top.severity : '', vulnIgnored: !!top && !active.length,
      vuln: top ? (active.length ? top.severity : `${top.severity} (ign)`) : '',
      advisories: vulns.map((v) => v.ghsa + (v.ignored ? '*' : '')).join(' '),
      state: meta?.deprecated ? 'DEPRECADA' : '', deprecation: meta?.deprecated || '',
      via: [...n.via].sort().join(', '),
      range: [...ranges].join(' | '), installable, copies: copies.get(n.name) > 1 ? copies.get(n.name) : '',
      published: meta?.time ? meta.time.slice(0, 10) : '', latestPublished: data?.latestTime ? data.latestTime.slice(0, 10) : '',
      age, lag, license: meta?.license || '', size: meta?.size ?? null,
      installScript: meta?.installScript ? 'sí' : '', repo: data?.repo || '',
      _key: n.key, _direct: direct, _vulns: vulns,
    });
  }

  /* ── filtros ── */
  let out = rows;
  if (flags.has('prod')) out = out.filter((r) => r.scope === 'prod');
  if (flags.has('dev')) out = out.filter((r) => r.scope === 'dev');
  if (flags.has('direct')) out = out.filter((r) => r._direct);
  if (flags.has('transitive')) out = out.filter((r) => !r._direct);
  if (opts.name) {
    const re = new RegExp('^' + opts.name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    out = out.filter((r) => re.test(r.name));
  }
  const only = ['only-vulnerable', 'only-deprecated', 'only-outdated', 'only-patched'].filter((f) => flags.has(f));
  if (flags.has('only-vulnerable')) out = out.filter((r) => r.vuln && SEV[r.vulnSeverity] >= minSev);
  if (flags.has('only-deprecated')) out = out.filter((r) => r.state);
  if (flags.has('only-outdated')) out = out.filter((r) => r.change);
  if (flags.has('only-patched')) out = out.filter((r) => r.patch);
  if (!only.length && !flags.has('all')) out = out.filter((r) => r.change || r.state || r.vuln || r.patch === 'NO APLICADO');

  const sevRank = (r) => (r.vuln ? SEV[r.vulnSeverity] + (r.vulnIgnored ? 0 : 10) : -1);
  const chRank = { MAJOR: 3, minor: 2, patch: 1, '': 0 };
  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name) || a.current.localeCompare(b.current, undefined, { numeric: true }),
    change: (a, b) => chRank[b.change] - chRank[a.change] || a.name.localeCompare(b.name),
    vuln: (a, b) => sevRank(b) - sevRank(a) || a.name.localeCompare(b.name),
    age: (a, b) => (b.age ?? -1) - (a.age ?? -1) || a.name.localeCompare(b.name),
  };
  out.sort(sorters[opts.sort] || sorters.name);

  /* ── salida ── */
  const fmtSize = (b) => (b == null ? '' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const COLS = {
    name: ['Paquete', (r) => r.name], current: ['Actual', (r) => r.current], latest: ['Última', (r) => r.latest],
    change: ['Cambio', (r) => r.change, (s) => (s === 'MAJOR' ? yellow(s) : s === 'minor' ? cyan(s) : dim(s))],
    type: ['Tipo', (r) => r.type], scope: ['Ámbito', (r) => r.scope],
    patch: ['Parche', (r) => r.patch, (s) => (s === 'sí' ? green(s) : red(s))],
    vuln: ['Vuln', (r) => r.vuln, (s, r) => (r.vulnIgnored ? dim(s) : SEV[r.vulnSeverity] >= 3 ? red(s) : yellow(s))],
    state: ['Estado', (r) => r.state, (s) => yellow(s)],
    via: ['Traído por', (r) => r.via, null, 36],
    range: ['Rango', (r) => r.range, null, 28], installable: ['Instalable', (r) => r.installable, (s) => (s === 'no' ? yellow(s) : s)],
    copies: ['Copias', (r) => r.copies], published: ['Publicada', (r) => r.published], latestPublished: ['Pub. última', (r) => r.latestPublished],
    age: ['Edad(d)', (r) => r.age ?? ''], lag: ['Atraso(d)', (r) => r.lag ?? ''], license: ['Licencia', (r) => r.license, null, 22],
    size: ['Tamaño', (r) => fmtSize(r.size)], installScript: ['Install-script', (r) => r.installScript, (s) => yellow(s)],
    advisories: ['Avisos', (r) => r.advisories, null, 40], deprecation: ['Motivo deprec.', (r) => r.deprecation, null, 50], repo: ['Repo', (r) => r.repo, null, 50],
  };
  const baseCols = ['name', 'current', 'latest', 'change', 'type', 'scope', 'patch', 'vuln', 'state', 'via'];
  const detailCols = ['range', 'installable', 'copies', 'published', 'latestPublished', 'age', 'lag', 'license', 'size', 'installScript', 'advisories', 'deprecation', 'repo'];
  let cols = opts.cols ? opts.cols.split(',').map((s) => s.trim()).filter(Boolean) : DETAIL ? [...baseCols, ...detailCols] : baseCols;
  const bad = cols.filter((c) => !COLS[c]);
  if (bad.length) { console.error(`Columnas desconocidas: ${bad.join(', ')}\nDisponibles: ${Object.keys(COLS).join(' ')}`); process.exit(2); }
  if (flags.has('no-audit')) cols = cols.filter((c) => c !== 'vuln' && c !== 'advisories');

  const clip = (s, w) => (w && String(s).length > w ? String(s).slice(0, w - 1) + '…' : String(s));

  if (flags.has('json')) {
    console.log(JSON.stringify(out.map(({ _key, _direct, _vulns, vulnSeverity, vulnIgnored, ...r }) => ({ ...r, vulnerabilities: _vulns })), null, 2));
  } else if (flags.has('csv')) {
    const esc = (v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    console.log(cols.map((c) => esc(COLS[c][0])).join(','));
    for (const r of out) console.log(cols.map((c) => esc(COLS[c][1](r))).join(','));
  } else {
    const printTable = (list) => {
      const widths = cols.map((c) => Math.max(COLS[c][0].length, ...list.map((r) => clip(COLS[c][1](r), COLS[c][3]).length)));
      const line = (cells) => cells.join('  ');
      console.log(dim(line(cols.map((c, i) => COLS[c][0].padEnd(widths[i])))));
      console.log(dim(widths.map((w) => '─'.repeat(w)).join('  ')));
      for (const r of list) {
        console.log(line(cols.map((c, i) => {
          const raw = clip(COLS[c][1](r), COLS[c][3]);
          const colored = raw && COLS[c][2] ? COLS[c][2](raw, r) : raw;
          return colored + ' '.repeat(widths[i] - raw.length);
        })).trimEnd());
      }
    };
    if (!out.length) console.log('Nada que mostrar con esos filtros.');
    else if (flags.has('group')) {
      const groups = new Map();
      for (const r of out) for (const v of (r.via || '(raíz)').split(', ')) { if (!groups.has(v)) groups.set(v, []); groups.get(v).push(r); }
      for (const [g, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
        const rr = roots.find((x) => x.name === g);
        console.log(`\n${C(1, g)} ${dim(rr ? `(${rr.scope}, ${rr.range})` : '')}  ${dim(list.length + ' paquetes')}`);
        printTable(list);
      }
    } else printTable(out);
  }

  /* ── resumen y control ── */
  const nOut = rows.filter((r) => r.change).length;
  const nDep = rows.filter((r) => r.state).length;
  const nVuln = rows.filter((r) => r.vuln && !r.vulnIgnored).length;
  const nIgn = rows.filter((r) => r.vuln && r.vulnIgnored).length;
  const nPatched = rows.filter((r) => r.patch === 'sí').length;
  const broken = [];
  for (const spec of registeredPatches) {
    const [nm, ver] = splitSpec(spec);
    const inst = [...nodes.values()].filter((n) => n.name === nm && (!ver || n.version === ver));
    if (!inst.length) broken.push(`${spec}: registrado pero esa versión no está instalada`);
    else if (!inst.some((n) => n.patched)) broken.push(`${spec}: registrado pero NO aplicado`);
  }
  console.error(`\n${rows.length} paquetes (${roots.length} directos) | ${nOut} con versión nueva | ${nDep} deprecados | ` +
    `${nVuln} vulnerables${nIgn ? ` + ${nIgn} ignorados` : ''} | ${nPatched} parchados` + (auditStatus !== 'ok' ? ` | audit: ${auditStatus}` : ''));
  for (const b of broken) console.error(red(`✗ patch: ${b}`));

  const reasons = [];
  for (const f of (opts['fail-on'] || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (f === 'vulnerable') { const n = rows.filter((r) => r.vuln && !r.vulnIgnored && SEV[r.vulnSeverity] >= minSev).length; if (n) reasons.push(`${n} vulnerables sin ignorar`); }
    else if (f === 'deprecated') { if (nDep) reasons.push(`${nDep} deprecados`); }
    else if (f === 'deprecated-direct') { const n = rows.filter((r) => r.state && r._direct).length; if (n) reasons.push(`${n} directas deprecadas`); }
    else if (f === 'outdated-direct') { const n = rows.filter((r) => r.change && r._direct).length; if (n) reasons.push(`${n} directas con versión nueva`); }
    else if (f === 'patch-broken') { if (broken.length) reasons.push(`${broken.length} patches sin aplicar`); }
    else { console.error(`--fail-on desconocido: ${f}`); process.exit(2); }
  }
  if (reasons.length) { console.error(red(`FALLA (--fail-on): ${reasons.join('; ')}`)); process.exit(1); }
})();
