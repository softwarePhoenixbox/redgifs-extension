import { zipSync, strToU8 } from 'fflate';
import { bytesToBase64, type LinkRow } from './links-db';

// ---------- Utilidades ----------
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // caracteres no válidos en XML
}

const escapeHtml = escapeXml;

function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function tagsToText(tags: string[]): string {
  return tags.join(' ');
}

// ---------- Excel (.xlsx) ----------
const XLSX_HEADERS = [
  'ID',
  'Gif ID',
  'Título',
  'Autor',
  'Tags',
  'Vistas',
  'Likes',
  'Video (URL)',
  'Imagen (URL)',
  'Página',
  'Fecha',
] as const;
const XLSX_WIDTHS = [6, 30, 45, 20, 40, 10, 10, 55, 55, 60, 20];

function colLetter(index: number): string {
  // Soporta hasta columnas AA..AZ por si se agregan más adelante
  return index < 26
    ? String.fromCharCode(65 + index)
    : String.fromCharCode(65 + Math.floor(index / 26) - 1) + String.fromCharCode(65 + (index % 26));
}

function textCell(ref: string, value: string, style = 0): string {
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

export function buildXlsx(rows: LinkRow[]): Uint8Array {
  const headerCells = XLSX_HEADERS.map((h, i) => textCell(`${colLetter(i)}1`, h, 1)).join('');
  const bodyRows = rows
    .map((row, i) => {
      const r = i + 2;
      const cells = [
        `<c r="A${r}"><v>${row.id}</v></c>`,
        textCell(`B${r}`, row.gifId),
        textCell(`C${r}`, row.title ?? ''),
        textCell(`D${r}`, row.author ?? ''),
        textCell(`E${r}`, tagsToText(row.tags)),
        textCell(`F${r}`, row.views ?? ''),
        textCell(`G${r}`, row.likes ?? ''),
        textCell(`H${r}`, row.url),
        textCell(`I${r}`, row.imageUrl ?? ''),
        textCell(`J${r}`, row.pageUrl ?? ''),
        textCell(`K${r}`, row.createdAt),
      ];
      return `<row r="${r}">${cells.join('')}</row>`;
    })
    .join('');

  const cols = XLSX_WIDTHS.map(
    (w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`,
  ).join('');

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols>` +
    `<sheetData><row r="1">${headerCells}</row>${bodyRows}</sheetData>` +
    `</worksheet>`;

  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;

  const files = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="links" sheetId="1" r:id="rId1"/></sheets>` +
        `</workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };

  return zipSync(files);
}

// ---------- HTML con imágenes incrustadas (data URI) ----------
async function fetchDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
    return `data:${type};base64,${bytesToBase64(new Uint8Array(await res.arrayBuffer()))}`;
  } catch {
    return null;
  }
}

// Ejecuta `fn` sobre todos los elementos, con máximo `limit` a la vez
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function tagChips(tags: string[]): string {
  if (!tags.length) return '';
  return `<div class="tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`;
}

// JS que corre DENTRO del HTML exportado (archivo local, sin relación con la
// extensión). Se encarga de: descargar el video, incrustarle título / autor /
// tags / fecha con ffmpeg.wasm (remux con -c copy, sin recodificar) y disparar
// la descarga del archivo final. Deliberadamente sin template literals para no
// pelear con el escapeo del backtick que envuelve todo buildHtml().
const DOWNLOAD_SCRIPT = [
  '(function () {',
  "  var CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/';",
  '  // Worker interno de ffmpeg.wasm para esta versión (nombre fijo del chunk).',
  "  var FFMPEG_WORKER_URL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/umd/814.ffmpeg.js';",
  "  var rowsEl = document.getElementById('rg-rows');",
  '  var ROWS = {};',
  '  try { ROWS = JSON.parse(rowsEl.textContent); } catch (e) { ROWS = {}; }',
  '',
  '  // Este HTML se abre normalmente como archivo local (file://), con origen',
  "  // 'null'. El navegador nunca deja crear un Worker cross-origin desde un",
  '  // origen null (aunque el CDN mande CORS bien), así que descargamos los',
  '  // scripts con fetch y los pasamos como blob: URLs, que sí pueden usarse',
  '  // para crear Workers sin importar el origen de la página.',
  '  function toBlobURL(url, mimeType) {',
  '    return fetch(url)',
  '      .then(function (resp) {',
  "        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' al descargar ' + url);",
  '        return resp.blob();',
  '      })',
  '      .then(function (blob) {',
  '        return URL.createObjectURL(new Blob([blob], { type: mimeType }));',
  '      });',
  '  }',
  '',
  '  // La API oficial (ff.load({classWorkerURL})) fuerza el worker a tipo',
  '  // "module", pero el chunk 814.ffmpeg.js de esta build UMD es un worker',
  '  // "clásico" (usa importScripts): forzarlo a module rompe con "Refused to',
  '  // cross-origin redirects of the top-level worker script." Por eso se habla',
  '  // directo con el worker usando su propio protocolo de mensajes',
  '  // (LOAD/WRITE_FILE/EXEC/READ_FILE/DELETE_FILE) sin pasar por la clase',
  '  // FFmpeg del paquete.',
  '  var progressHandler = null;',
  '  var ffmpegPromise = null;',
  '  function loadFFmpeg() {',
  '    if (ffmpegPromise) return ffmpegPromise;',
  '    ffmpegPromise = (async function () {',
  '      // Solo el script del worker necesita ser blob (por la restricción',
  '      // de construcción de Workers cross-origin). ffmpeg-core.js y el',
  '      // .wasm se cargan DESDE DENTRO del worker via importScripts/fetch,',
  '      // que no tiene esa restricción -- y de hecho un blob creado en la',
  '      // página principal no es accesible desde el worker de todos modos',
  '      // (cada uno tiene su propio origen opaco en una página file://).',
  "      var workerBlobUrl = await toBlobURL(FFMPEG_WORKER_URL, 'text/javascript');",
  '      var worker = new Worker(workerBlobUrl);',
  '      var nextId = 0;',
  '      var pending = {};',
  '      worker.onmessage = function (ev) {',
  '        var msg = ev.data || {};',
  "        if (msg.type === 'PROGRESS') {",
  '          if (progressHandler) progressHandler(msg.data);',
  '          return;',
  '        }',
  '        var p = pending[msg.id];',
  '        if (!p) return;',
  '        delete pending[msg.id];',
  "        if (msg.type === 'ERROR') {",
  "          p.reject(new Error(typeof msg.data === 'string' ? msg.data : 'Error de ffmpeg'));",
  '        } else {',
  '          p.resolve(msg.data);',
  '        }',
  '      };',
  '      worker.onerror = function (err) {',
  "        var message = (err && err.message) || 'Error desconocido del worker de ffmpeg';",
  '        Object.keys(pending).forEach(function (id) {',
  '          pending[id].reject(new Error(message));',
  '          delete pending[id];',
  '        });',
  '      };',
  '      function send(type, data, transfer) {',
  '        return new Promise(function (resolve, reject) {',
  '          var id = nextId++;',
  '          pending[id] = { resolve: resolve, reject: reject };',
  '          worker.postMessage({ id: id, type: type, data: data }, transfer || []);',
  '        });',
  '      }',
  "      await send('LOAD', { coreURL: CORE_BASE + 'ffmpeg-core.js', wasmURL: CORE_BASE + 'ffmpeg-core.wasm' });",
  '      return {',
  "        writeFile: function (path, data) { return send('WRITE_FILE', { path: path, data: data }, [data.buffer]); },",
  "        exec: function (args) { return send('EXEC', { args: args, timeout: -1 }); },",
  "        readFile: function (path) { return send('READ_FILE', { path: path, encoding: 'binary' }); },",
  "        deleteFile: function (path) { return send('DELETE_FILE', { path: path }); },",
  '      };',
  '    })();',
  '    return ffmpegPromise;',
  '  }',
  '',
  '',
  "  // ---- Atomo 'Xtra' (columnas Titulo / Autores / Etiquetas del Explorador de Windows) ----",
  '  // El Explorador NO lee los atoms estilo iTunes (\\u00a9nam/\\u00a9ART/keyw) que ffmpeg ya escribe;',
  '  // para esas columnas usa un atom propio de Microsoft (moov/udta/Xtra), el mismo',
  '  // esquema binario (tipo ASF/WMA "content descriptor", UTF-16LE) que usa en .wma/.asf.',
  '  // Microsoft nunca lo documento: lo que sigue es la hipotesis mas solida que encontre',
  '  // (coincide con lo poco reportado por quienes lo reversearon para mp4v2, issue #113),',
  '  // pero no la pude verificar byte a byte sin un Windows a mano. Si las columnas no',
  '  // aparecen tras probar esto, ver la nota al final del archivo sobre como sacar una',
  '  // muestra real y ajustar buildXtraEntry().',
  '  //',
  '  // La parte de abajo que arma/inserta el box (tamanos, udta, ajuste de stco/co64 si',
  '  // moov queda antes que mdat) SI es standard ISO/IEC 14496-12, sin nada experimental.',
  '',
  '  function u32beRead(bytes, off) {',
  '    return ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;',
  '  }',
  '  function fourccRead(bytes, off) {',
  '    return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);',
  '  }',
  '  function u32beWrite(bytes, off, val) {',
  '    bytes[off] = (val >>> 24) & 0xff; bytes[off + 1] = (val >>> 16) & 0xff;',
  '    bytes[off + 2] = (val >>> 8) & 0xff; bytes[off + 3] = val & 0xff;',
  '  }',
  '',
  '  // UTF-16LE terminada en NUL, como persiste WMP estas cadenas.',
  '  function encodeUtf16leZ(str) {',
  '    var out = new Uint8Array((str.length + 1) * 2);',
  '    var view = new DataView(out.buffer);',
  '    for (var i = 0; i < str.length; i++) view.setUint16(i * 2, str.charCodeAt(i), true);',
  '    view.setUint16(str.length * 2, 0, true);',
  '    return out;',
  '  }',
  '',
  '  // Un "content descriptor": nombre + tipo (0 = cadena unicode) + valor, todo LE.',
  '  function buildXtraEntry(name, value) {',
  '    var nameBytes = encodeUtf16leZ(name);',
  '    var valueBytes = encodeUtf16leZ(value);',
  '    var entry = new Uint8Array(2 + nameBytes.length + 2 + 2 + valueBytes.length);',
  '    var view = new DataView(entry.buffer);',
  '    var off = 0;',
  '    view.setUint16(off, nameBytes.length, true); off += 2;',
  '    entry.set(nameBytes, off); off += nameBytes.length;',
  '    view.setUint16(off, 0, true); off += 2;',
  '    view.setUint16(off, valueBytes.length, true); off += 2;',
  '    entry.set(valueBytes, off); off += valueBytes.length;',
  '    return entry;',
  '  }',
  '',
  '  function buildXtraPayload(title, author, tags) {',
  '    var entries = [];',
  "    if (title) entries.push(buildXtraEntry('WM/Title', title));",
  "    if (author) entries.push(buildXtraEntry('WM/AlbumArtist', author));",
  "    if (tags) entries.push(buildXtraEntry('WM/Keywords', tags));",
  '    var total = 0;',
  '    for (var i = 0; i < entries.length; i++) total += entries[i].length;',
  '    var payload = new Uint8Array(total);',
  '    var pos = 0;',
  '    for (var j = 0; j < entries.length; j++) { payload.set(entries[j], pos); pos += entries[j].length; }',
  '    return payload;',
  '  }',
  '',
  '  function buildBox(fourcc, payload) {',
  '    var box = new Uint8Array(8 + payload.length);',
  '    u32beWrite(box, 0, box.length);',
  '    for (var i = 0; i < 4; i++) box[4 + i] = fourcc.charCodeAt(i);',
  '    box.set(payload, 8);',
  '    return box;',
  '  }',
  '',
  '  function readTopBoxes(bytes) {',
  '    return findChildBoxes(bytes, 0, bytes.length);',
  '  }',
  '  function findChildBoxes(bytes, start, end) {',
  '    var boxes = []; var off = start;',
  '    while (off + 8 <= end) {',
  '      var size = u32beRead(bytes, off);',
  '      var type = fourccRead(bytes, off + 4);',
  '      if (size < 8) break; // no esperamos largesize/0 en estos archivos',
  '      boxes.push({ type: type, start: off, size: size });',
  '      off += size;',
  '    }',
  '    return boxes;',
  '  }',
  '  function findAllBoxesRecursive(bytes, start, end, type, out) {',
  '    var kids = findChildBoxes(bytes, start, end);',
  '    for (var i = 0; i < kids.length; i++) {',
  '      if (kids[i].type === type) out.push(kids[i]);',
  "      if (kids[i].type === 'trak' || kids[i].type === 'mdia' || kids[i].type === 'minf' || kids[i].type === 'stbl') {",
  '        findAllBoxesRecursive(bytes, kids[i].start + 8, kids[i].start + kids[i].size, type, out);',
  '      }',
  '    }',
  '  }',
  '',
  '  // Suma delta a cada entrada de una tabla stco (32 bits) o co64 (64 bits).',
  '  function patchChunkOffsets(bytes, box, delta) {',
  '    var count = u32beRead(bytes, box.start + 12);',
  "    var entrySize = box.type === 'stco' ? 4 : 8;",
  '    var pos = box.start + 16;',
  '    for (var i = 0; i < count; i++) {',
  "      if (box.type === 'stco') {",
  '        u32beWrite(bytes, pos, u32beRead(bytes, pos) + delta);',
  '      } else {',
  '        var hi = u32beRead(bytes, pos);',
  '        var lo = u32beRead(bytes, pos + 4);',
  '        var newLo = (lo + delta) >>> 0;',
  '        if (newLo < lo) hi = (hi + 1) >>> 0; // acarreo',
  '        u32beWrite(bytes, pos, hi);',
  '        u32beWrite(bytes, pos + 4, newLo);',
  '      }',
  '      pos += entrySize;',
  '    }',
  '  }',
  '',
  '  // Inserta/reemplaza moov/udta/Xtra. Si moov queda antes que mdat en el',
  '  // archivo (no es el caso por defecto de ffmpeg sin +faststart, pero por',
  '  // las dudas), corrige stco/co64 para que sigan apuntando al mdat real.',
  '  function injectXtraBox(bytes, xtraPayload) {',
  '    var top = readTopBoxes(bytes);',
  '    var moov = null, mdat = null;',
  '    for (var i = 0; i < top.length; i++) {',
  "      if (top[i].type === 'moov') moov = top[i];",
  "      if (top[i].type === 'mdat') mdat = top[i];",
  '    }',
  "    if (!moov) throw new Error('No se encontro el box moov');",
  '',
  '    var moovKids = findChildBoxes(bytes, moov.start + 8, moov.start + moov.size);',
  '    var udta = null;',
  "    for (var j = 0; j < moovKids.length; j++) { if (moovKids[j].type === 'udta') udta = moovKids[j]; }",
  '',
  "    var toInsert = buildBox('Xtra', xtraPayload);",
  '    var insertAt, removeLen;',
  '    if (udta) {',
  '      var udtaKids = findChildBoxes(bytes, udta.start + 8, udta.start + udta.size);',
  '      var oldXtra = null;',
  "      for (var k = 0; k < udtaKids.length; k++) { if (udtaKids[k].type === 'Xtra') oldXtra = udtaKids[k]; }",
  '      insertAt = oldXtra ? oldXtra.start : (udta.start + udta.size);',
  '      removeLen = oldXtra ? oldXtra.size : 0;',
  '    } else {',
  "      toInsert = buildBox('udta', toInsert); // udta nuevo, con el Xtra adentro",
  '      insertAt = moov.start + moov.size;',
  '      removeLen = 0;',
  '    }',
  '    var sizeDelta = toInsert.length - removeLen;',
  '',
  '    var out = new Uint8Array(bytes.length - removeLen + toInsert.length);',
  '    out.set(bytes.subarray(0, insertAt), 0);',
  '    out.set(toInsert, insertAt);',
  '    out.set(bytes.subarray(insertAt + removeLen), insertAt + toInsert.length);',
  '',
  '    if (udta) u32beWrite(out, udta.start, udta.size + sizeDelta);',
  '    u32beWrite(out, moov.start, moov.size + sizeDelta);',
  '',
  '    if (mdat && moov.start < mdat.start) {',
  '      var stcoList = [], co64List = [];',
  "      findAllBoxesRecursive(out, moov.start + 8, moov.start + moov.size + sizeDelta, 'stco', stcoList);",
  "      findAllBoxesRecursive(out, moov.start + 8, moov.start + moov.size + sizeDelta, 'co64', co64List);",
  '      for (var s = 0; s < stcoList.length; s++) patchChunkOffsets(out, stcoList[s], sizeDelta);',
  '      for (var c = 0; c < co64List.length; c++) patchChunkOffsets(out, co64List[c], sizeDelta);',
  '    }',
  '    return out;',
  '  }',
  '',
  '  function extOf(url) {',
  '    var m = /\\.([a-z0-9]{2,5})(?:\\?|$)/i.exec(url);',
  "    return m ? m[1].toLowerCase() : 'mp4';",
  '  }',
  '',
  '  async function downloadWithMetadata(id, btn, statusEl) {',
  '    var row = ROWS[id];',
  "    if (!row) { statusEl.textContent = 'Sin datos guardados para incrustar'; return; }",
  '    btn.disabled = true;',
  '    progressHandler = function (p) {',
  "      var pct = p && typeof p.progress === 'number' ? Math.round(Math.max(0, Math.min(1, p.progress)) * 100) : null;",
  "      statusEl.textContent = pct === null ? 'Incrustando metadatos...' : 'Incrustando metadatos... ' + pct + '%';",
  '    };',
  '    try {',
  "      statusEl.textContent = 'Descargando video...';",
  '      var resp = await fetch(row.url);',
  "      if (!resp.ok) throw new Error('HTTP ' + resp.status);",
  '      var bytes = new Uint8Array(await resp.arrayBuffer());',
  '',
  "      statusEl.textContent = 'Descargando ffmpeg (~25 MB, solo la primera vez)...';",
  '      var ff = await loadFFmpeg();',
  '',
  '      var ext = extOf(row.url);',
  "      var inName = 'in.' + ext;",
  "      var outName = 'out.' + ext;",
  '      await ff.writeFile(inName, bytes);',
  '',
  "      var args = ['-i', inName, '-c', 'copy', '-movflags', 'use_metadata_tags'];",
  "      if (row.title) args.push('-metadata', 'title=' + row.title);",
  "      if (row.author) args.push('-metadata', 'artist=' + row.author);",
  "      if (row.tags) args.push('-metadata', 'comment=' + row.tags, '-metadata', 'keywords=' + row.tags);",
  "      if (row.date) args.push('-metadata', 'date=' + row.date);",
  '      args.push(outName);',
  '',
  "      statusEl.textContent = 'Incrustando metadatos...';",
  '      await ff.exec(args);',
  '      var data = await ff.readFile(outName);',
  '      var fileBytes = data.buffer ? new Uint8Array(data.buffer) : data;',
  '',
  "      // Columnas Titulo / Autores / Etiquetas del Explorador (atom Xtra, ver nota arriba).",
  "      // Envuelto en try/catch: si algo de esto falla, seguimos con el archivo tal cual",
  "      // salio de ffmpeg (que ya tiene el titulo/autor en los atoms estandar).",
  '      var xtraStatus = \'Xtra: sin datos para incrustar (no hay titulo/autor/tags guardados)\';',
  '      try {',
  "        var xtraPayload = buildXtraPayload(row.title, row.author, row.tags);",
  '        if (xtraPayload.length > 0) {',
  '          fileBytes = injectXtraBox(fileBytes, xtraPayload);',
  "          xtraStatus = 'Xtra: escrito (' + xtraPayload.length + ' bytes en el atom).';",
  '        }',
  '      } catch (xtraErr) {',
  "        xtraStatus = 'Xtra: FALLO - ' + (xtraErr && xtraErr.message ? xtraErr.message : xtraErr);",
  "        console.warn('[RG Scroller] No se pudo escribir el atom Xtra', xtraErr);",
  '      }',
  "      console.log('[RG Scroller] ' + xtraStatus);",
  '',
  "      var blob = new Blob([fileBytes], { type: 'video/mp4' });",
  '      var blobUrl = URL.createObjectURL(blob);',
  "      var a = document.createElement('a');",
  '      a.href = blobUrl;',
  "      a.download = id + '.' + ext;",
  '      document.body.appendChild(a);',
  '      a.click();',
  '      a.remove();',
  '      setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 15000);',
  '',
  '      try { await ff.deleteFile(inName); await ff.deleteFile(outName); } catch (e) {}',
  '',
  "      statusEl.textContent = 'Listo \u2714 -- ' + xtraStatus;",
  '    } catch (err) {',
  '      console.error(err);',
  "      statusEl.textContent = 'Error: usa el link Video (' + (err && err.message ? err.message : err) + ')';",
  '    } finally {',
  '      progressHandler = null;',
  '      btn.disabled = false;',
  '    }',
  '  }',
  '',
  "  document.querySelectorAll('.dlmeta').forEach(function (btn) {",
  "    var statusEl = btn.parentElement.querySelector('.dlmeta-status');",
  "    btn.addEventListener('click', function () {",
  "      downloadWithMetadata(btn.getAttribute('data-id'), btn, statusEl);",
  '    });',
  '  });',
  '})();',
].join('\n');

export async function buildHtml(rows: LinkRow[]): Promise<string> {
  // Si una imagen no se puede descargar, se deja el link remoto como respaldo
  const images = await mapLimit(rows, 6, async row => {
    const url = safeHttpsUrl(row.imageUrl);
    if (!url) return null;
    return (await fetchDataUrl(url)) ?? url;
  });

  const link = (href: string | null, label: string): string => {
    const safe = safeHttpsUrl(href);
    return safe
      ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
      : escapeHtml(label);
  };

  // Datos que el botón "Con metadatos" necesita en el navegador, por gif_id.
  const rowsById: Record<string, { url: string; title: string; author: string; tags: string; date: string }> = {};
  for (const row of rows) {
    const safeUrl = safeHttpsUrl(row.url);
    if (!safeUrl) continue;
    rowsById[row.gifId] = {
      url: safeUrl,
      title: row.title ?? '',
      author: row.author ?? '',
      tags: tagsToText(row.tags),
      date: row.createdAt.slice(0, 10),
    };
  }
  // Evita que un título/tag con "</script>" rompa el documento.
  const rowsJson = JSON.stringify(rowsById).replace(/</g, '\\u003c');

  const body = rows
    .map((row, i) => {
      const src = images[i];
      const img = src
        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(row.title ?? row.gifId)}">`
        : '';
      const hasVideo = safeHttpsUrl(row.url) !== null;
      const dlCell = hasVideo
        ? `<button class="dlmeta" data-id="${escapeHtml(row.gifId)}">⬇ Con metadatos</button><div class="dlmeta-status"></div>`
        : '';
      return (
        `<tr>` +
        `<td>${row.id}</td>` +
        `<td class="img">${img}</td>` +
        `<td>${escapeHtml(row.gifId)}</td>` +
        `<td>${escapeHtml(row.title ?? '')}</td>` +
        `<td>${escapeHtml(row.author ?? '')}</td>` +
        `<td>${tagChips(row.tags)}</td>` +
        `<td class="num">${escapeHtml(row.views ?? '')}</td>` +
        `<td class="num">${escapeHtml(row.likes ?? '')}</td>` +
        `<td>${link(row.url, 'Video')}</td>` +
        `<td>${link(row.pageUrl, 'Página')}</td>` +
        `<td>${escapeHtml(row.createdAt)}</td>` +
        `<td class="dl">${dlCell}</td>` +
        `</tr>`
      );
    })
    .join('\n');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Links guardados (${rows.length})</title>
<style>
  body { font-family: system-ui, sans-serif; background: #121212; color: #eee; margin: 24px; }
  h1 { font-size: 18px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #333; padding: 8px; text-align: left; vertical-align: middle; font-size: 13px; }
  th { background: #1e1e1e; position: sticky; top: 0; }
  td.img { width: 150px; }
  td.img img { display: block; max-width: 140px; max-height: 200px; border-radius: 6px; }
  td.num { text-align: right; white-space: nowrap; }
  td.dl { min-width: 140px; }
  a { color: #6cb6ff; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; max-width: 220px; }
  .tag { background: #263238; color: #9fd3ff; border-radius: 10px; padding: 2px 8px; font-size: 11px; white-space: nowrap; }
  .dlmeta { background: #2f6bff; color: #fff; border: none; border-radius: 6px; padding: 6px 10px; font-size: 11px; font-weight: bold; cursor: pointer; width: 100%; }
  .dlmeta:disabled { opacity: 0.6; cursor: wait; }
  .dlmeta-status { font-size: 10px; color: #aaa; margin-top: 4px; min-height: 12px; }
</style>
</head>
<body>
<h1>Links guardados: ${rows.length}</h1>
<p style="color:#888; font-size:12px;">
  "Con metadatos" descarga el video con título / autor / tags / fecha incrustados
  (usa ffmpeg.wasm cargado desde CDN, corre en tu navegador). La primera vez tarda
  un poco más porque descarga el motor de ffmpeg.
</p>
<table>
<thead><tr>
  <th>ID</th><th>Imagen</th><th>Gif ID</th><th>Título</th><th>Autor</th><th>Tags</th>
  <th>Vistas</th><th>Likes</th><th>Video</th><th>Página</th><th>Fecha</th><th>Descargar</th>
</tr></thead>
<tbody>
${body}
</tbody>
</table>
<script id="rg-rows" type="application/json">${rowsJson}</script>
<script>
${DOWNLOAD_SCRIPT}
</script>
</body>
</html>
`;
}