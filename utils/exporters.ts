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

// JS que corre dentro del HTML exportado. Escribe el atom Xtra directamente,
// sin iniciar ffmpeg ni descargar un motor wasm de ~25 MB.
const DOWNLOAD_SCRIPT = [
  '(function () {',
  "  var rowsEl = document.getElementById('rg-rows');",
  '  var ROWS = {};',
  '  try { ROWS = JSON.parse(rowsEl.textContent); } catch (e) { ROWS = {}; }',
  '',
  "  // ---- Atomo 'Xtra' (columnas Titulo / Autores / Etiquetas del Explorador de Windows) ----",
  '  // El Explorador usa el atom Xtra de Microsoft para estas propiedades multimedia;',
  '  // para esas columnas usa un atom propio de Microsoft (moov/udta/Xtra), el mismo',
  '  // Xtra MP4 usa registros Microsoft con nombre ASCII y valor tipado UTF-16LE.',
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
  '  // Registro Xtra: tamaños/nombre big-endian; tipo 8 y valor UTF-16LE.',
  '  function buildXtraEntry(name, value) {',
  '    var nameBytes = new Uint8Array(name.length);',
  '    for (var n = 0; n < name.length; n++) nameBytes[n] = name.charCodeAt(n);',
  '    var valueBytes = encodeUtf16leZ(value);',
  '    var entry = new Uint8Array(18 + nameBytes.length + valueBytes.length);',
  '    var view = new DataView(entry.buffer);',
  '    var off = 0;',
  '    view.setUint32(off, entry.length, false); off += 4;',
  '    view.setUint32(off, nameBytes.length, false); off += 4;',
  '    entry.set(nameBytes, off); off += nameBytes.length;',
  '    view.setUint32(off, 1, false); off += 4;',
  '    view.setUint32(off, valueBytes.length + 6, false); off += 4;',
  '    view.setUint16(off, 8, false); off += 2;',
  '    entry.set(valueBytes, off);',
  '    return entry;',
  '  }',
  '',
  '  function buildXtraPayload(title, author, tags, pageUrl) {',
  '    var entries = [];',
  "    if (title) entries.push(buildXtraEntry('WM/Title', title));",
  "    if (author) entries.push(buildXtraEntry('WM/Author', author));",
  "    if (tags) entries.push(buildXtraEntry('WM/Category', tags));",
  "    if (pageUrl) entries.push(buildXtraEntry('WM/PromotionURL', pageUrl));",
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
  '  function buildQuickTimeTextItem(fourcc, value) {',
  '    var valueBytes = new TextEncoder().encode(value);',
  "    var data = new Uint8Array(16 + valueBytes.length);",
  '    u32beWrite(data, 0, data.length);',
  "    data.set([100, 97, 116, 97], 4);",
  '    u32beWrite(data, 8, 1); // UTF-8 text',
  '    data.set(valueBytes, 16);',
  '    var item = new Uint8Array(8 + data.length);',
  '    u32beWrite(item, 0, item.length);',
  '    for (var i = 0; i < 4; i++) item[4 + i] = fourcc.charCodeAt(i) & 0xff;',
  '    item.set(data, 8);',
  '    return item;',
  '  }',
  '',
  '  function buildQuickTimeMetadata(title, author) {',
  '    var items = [];',
  "    if (title) items.push(buildQuickTimeTextItem('©nam', title));",
  "    if (author) items.push(buildQuickTimeTextItem('©ART', author));",
  '    var ilstSize = 8;',
  '    for (var i = 0; i < items.length; i++) ilstSize += items[i].length;',
  '    var ilst = new Uint8Array(ilstSize);',
  '    u32beWrite(ilst, 0, ilst.length); ilst.set([105, 108, 115, 116], 4);',
  '    var pos = 8;',
  '    for (var j = 0; j < items.length; j++) { ilst.set(items[j], pos); pos += items[j].length; }',
  '    var hdlr = new Uint8Array(33);',
  '    u32beWrite(hdlr, 0, hdlr.length); hdlr.set([104, 100, 108, 114], 4);',
  '    hdlr.set([109, 100, 105, 114], 16); // handler type: mdir',
  '    var meta = new Uint8Array(12 + hdlr.length + ilst.length);',
  '    u32beWrite(meta, 0, meta.length); meta.set([109, 101, 116, 97], 4);',
  '    meta.set(hdlr, 12); meta.set(ilst, 12 + hdlr.length);',
  '    return meta;',
  '  }',
  '',
  '  function injectQuickTimeMetadata(bytes, title, author) {',
  '    if (!title && !author) return bytes;',
  '    var top = readTopBoxes(bytes); var moov = null; var mdat = null;',
  '    for (var i = 0; i < top.length; i++) {',
  "      if (top[i].type === 'moov') moov = top[i];",
  "      if (top[i].type === 'mdat') mdat = top[i];",
  '    }',
  "    if (!moov) throw new Error('No se encontró moov para title/author');",
  '    var kids = findChildBoxes(bytes, moov.start + 8, moov.start + moov.size);',
  "    var udta = null; for (var j = 0; j < kids.length; j++) if (kids[j].type === 'udta') udta = kids[j];",
  '    var meta = buildQuickTimeMetadata(title, author); var insertAt; var wrapper;',
  '    if (udta) {',
  "      var ukids = findChildBoxes(bytes, udta.start + 8, udta.start + udta.size);",
  "      if (ukids.some(function (b) { return b.type === 'meta'; })) throw new Error('El MP4 ya contiene meta QuickTime');",
  '      insertAt = udta.start + udta.size; wrapper = meta;',
  '    } else {',
  "      wrapper = buildBox('udta', meta); insertAt = moov.start + moov.size;",
  '    }',
  '    var delta = wrapper.length;',
  '    var out = new Uint8Array(bytes.length + delta);',
  '    out.set(bytes.subarray(0, insertAt), 0); out.set(wrapper, insertAt);',
  '    out.set(bytes.subarray(insertAt), insertAt + delta);',
  '    if (udta) u32beWrite(out, udta.start, udta.size + delta);',
  '    u32beWrite(out, moov.start, moov.size + delta);',
  '    if (mdat && moov.start < mdat.start) {',
  '      var stco = [], co64 = [];',
  "      findAllBoxesRecursive(out, moov.start + 8, moov.start + moov.size + delta, 'stco', stco);",
  "      findAllBoxesRecursive(out, moov.start + 8, moov.start + moov.size + delta, 'co64', co64);",
  '      for (var s = 0; s < stco.length; s++) patchChunkOffsets(out, stco[s], delta);',
  '      for (var c = 0; c < co64.length; c++) patchChunkOffsets(out, co64[c], delta);',
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
  '    try {',
  "      statusEl.textContent = 'Descargando video...';",
  '      var resp = await fetch(row.url);',
  "      if (!resp.ok) throw new Error('HTTP ' + resp.status);",
  '      var bytes = new Uint8Array(await resp.arrayBuffer());',
  '',
  '      var ext = extOf(row.url);',
  "      if (ext !== 'mp4' && ext !== 'm4v') throw new Error('La incrustación Xtra solo admite MP4/M4V');",
  "      statusEl.textContent = 'Incrustando metadatos...';",
  '      var fileBytes = bytes;',
  '',
      "      // El atom Xtra representa las propiedades multimedia de Windows.",
  '      var xtraPayload = buildXtraPayload(row.title, row.author, row.tags, row.pageUrl);',
  "      if (!xtraPayload.length) throw new Error('No hay título, autor o tags guardados');",
  '      fileBytes = injectXtraBox(fileBytes, xtraPayload);',
  '      fileBytes = injectQuickTimeMetadata(fileBytes, row.title, row.author);',
  "      var xtraStatus = 'Título, autor y tags incrustados; revisa las columnas en Windows.';",
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
  "      statusEl.textContent = 'Listo \u2714 -- ' + xtraStatus;",
  '      if (row.pageUrl) {',
  "        statusEl.appendChild(document.createTextNode(' '));",
  "        var shortcut = document.createElement('a');",
  "        var shortcutText = '[InternetShortcut]\\r\\nURL=' + row.pageUrl.replace(/[\\r\\n]/g, '') + '\\r\\n';",
  "        shortcut.href = URL.createObjectURL(new Blob([shortcutText], { type: 'application/internet-shortcut' }));",
  "        shortcut.download = id + '.url.txt';",
  "        shortcut.textContent = 'Descargar URL (.txt; renombrar a .url)';",
  "        statusEl.appendChild(shortcut);",
  '      }',
  '    } catch (err) {',
  '      console.error(err);',
  "      statusEl.textContent = 'Error: usa el link Video (' + (err && err.message ? err.message : err) + ')';",
  '    } finally {',
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
  const rowsById: Record<string, { url: string; pageUrl: string; title: string; author: string; tags: string; date: string }> = {};
  for (const row of rows) {
    const safeUrl = safeHttpsUrl(row.url);
    if (!safeUrl) continue;
    rowsById[row.gifId] = {
      url: safeUrl,
      pageUrl: safeHttpsUrl(row.pageUrl) ?? '',
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
  "Con metadatos" incrusta título, autor y tags en el MP4. Para la columna URL, descarga
  el acceso como .url.txt y renómbralo a .url; Chrome protege las descargas .url directas.
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
