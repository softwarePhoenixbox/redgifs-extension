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

// ---------- Excel (.xlsx) ----------
const XLSX_HEADERS = ['ID', 'Gif ID', 'Video (URL)', 'Imagen (URL)', 'Página', 'Fecha'] as const;
const XLSX_WIDTHS = [6, 30, 55, 55, 60, 20];

function colLetter(index: number): string {
  return String.fromCharCode(65 + index); // A..F
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
        textCell(`C${r}`, row.url),
        textCell(`D${r}`, row.imageUrl ?? ''),
        textCell(`E${r}`, row.pageUrl ?? ''),
        textCell(`F${r}`, row.createdAt),
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

  const body = rows
    .map((row, i) => {
      const src = images[i];
      const img = src
        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(row.gifId)}">`
        : '';
      return (
        `<tr>` +
        `<td>${row.id}</td>` +
        `<td class="img">${img}</td>` +
        `<td>${escapeHtml(row.gifId)}</td>` +
        `<td>${link(row.url, 'Video')}</td>` +
        `<td>${link(row.pageUrl, 'Página')}</td>` +
        `<td>${escapeHtml(row.createdAt)}</td>` +
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
  a { color: #6cb6ff; }
</style>
</head>
<body>
<h1>Links guardados: ${rows.length}</h1>
<table>
<thead><tr><th>ID</th><th>Imagen</th><th>Gif ID</th><th>Video</th><th>Página</th><th>Fecha</th></tr></thead>
<tbody>
${body}
</tbody>
</table>
</body>
</html>
`;
}