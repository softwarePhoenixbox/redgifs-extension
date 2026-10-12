import { unzipSync, strFromU8 } from 'fflate';
import { XMLValidator } from 'fast-xml-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkRow } from '../utils/links-db';
import { buildHtml, buildXlsx } from '../premium/exporters';
import { installFetch } from './helpers/env';

const row = (over: Partial<LinkRow> = {}): LinkRow => ({
  id: 1, gifId: 'abc', url: 'https://media.redgifs.com/abc.mp4', imageUrl: 'https://media.redgifs.com/abc.jpg',
  pageUrl: 'https://www.redgifs.com/watch/abc', createdAt: '2026-10-01 10:00:00', title: 'T', author: 'A',
  tags: ['#a', '#b'], views: '10', likes: '2', ...over,
});

beforeEach(() => { installFetch(); });
afterEach(() => vi.unstubAllGlobals());

describe('buildXlsx', () => {
  const sheet = (rows: LinkRow[], lang: 'en' | 'es' = 'en') => {
    const files = unzipSync(buildXlsx(rows, lang));
    return { files, xml: strFromU8(files['xl/worksheets/sheet1.xml']!) };
  };

  it('genera un zip OOXML con las partes obligatorias y XML bien formado', () => {
    const { files } = sheet([row()]);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']));
    for (const [name, data] of Object.entries(files)) {
      expect(XMLValidator.validate(strFromU8(data)), name).toBe(true);
    }
  });

  it('una fila por link más el encabezado; el idioma cambia los títulos', () => {
    const rows = [row({ id: 1 }), row({ id: 2, gifId: 'b' }), row({ id: 3, gifId: 'c' })];
    expect(sheet(rows).xml.match(/<row /g)).toHaveLength(4);
    expect(sheet([row()], 'es').xml).toContain('Título');
    expect(sheet([row()], 'en').xml).toContain('Title');
  });

  it('escapa XML y elimina caracteres de control (si no, Excel dice "archivo dañado")', () => {
    const evil = row({ title: '<script>alert(1)</script> & "q" \u0001\u0008 fin', author: ']]></t><c r="Z9">' });
    const { xml, files } = sheet([evil]);
    expect(XMLValidator.validate(strFromU8(files['xl/worksheets/sheet1.xml']!))).toBe(true);
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&lt;script&gt;');
    expect(xml).not.toMatch(/[\u0000-\u0008]/);
    expect(xml).not.toContain('<c r="Z9">');
  });

  it('valores nulos quedan como celdas vacías y no escriben "null"', () => {
    const { xml } = sheet([row({ title: null, author: null, views: null, likes: null, imageUrl: null, pageUrl: null })]);
    expect(xml).not.toContain('null');
    expect(xml).not.toContain('undefined');
  });

  it('lista vacía produce un libro válido solo con encabezados', () => {
    const { xml, files } = sheet([]);
    expect(xml.match(/<row /g)).toHaveLength(1);
    expect(XMLValidator.validate(strFromU8(files['xl/worksheets/sheet1.xml']!))).toBe(true);
  });

  it('10 000 filas se generan en tiempo razonable', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => row({ id: i + 1, gifId: `g${i}` }));
    const t = performance.now();
    const out = buildXlsx(rows);
    expect(performance.now() - t).toBeLessThan(5000);
    expect(out.length).toBeGreaterThan(10_000);
  });
});

describe('buildHtml', () => {
  it('incrusta la imagen como data URI y conserva el orden de las filas', async () => {
    installFetch(() => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png; charset=x' } }));
    const html = await buildHtml([row({ gifId: 'first' }), row({ id: 2, gifId: 'second' })]);
    expect(html).toContain('src="data:image/png;base64,AQID"');
    expect(html.indexOf('first')).toBeLessThan(html.indexOf('second'));
  });

  it('si la imagen no se puede descargar, deja la URL remota como respaldo', async () => {
    installFetch(() => new Response('', { status: 500 }));
    expect(await buildHtml([row()])).toContain('src="https://media.redgifs.com/abc.jpg"');
    installFetch(() => { throw new TypeError('Failed to fetch'); });
    expect(await buildHtml([row()])).toContain('src="https://media.redgifs.com/abc.jpg"');
  });

  it('no descarga ni enlaza URLs que no sean https (http:, javascript:, data:)', async () => {
    const f = installFetch(() => new Response(new Uint8Array([1])));
    const html = await buildHtml([row({ imageUrl: 'http://x.test/a.jpg', url: 'javascript:alert(1)', pageUrl: 'data:text/html,<script>1</script>' })]);
    expect(f.mock.calls.filter(c => !String(c[0]).endsWith('.wasm'))).toHaveLength(0);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
    expect(html).not.toContain('class="dlmeta"'); // sin video válido no hay botón
  });

  it('un título con </script> o comillas no puede salirse del HTML ni del JSON embebido', async () => {
    const payload = '"></td><img src=x onerror=alert(1)></script><script>alert(2)</script>';
    const html = await buildHtml([row({ title: payload, author: payload, tags: [payload], gifId: payload.replace(/[^a-z]/g, 'q') })]);
    expect(html).not.toContain('<img src=x');
    expect(html.match(/<script/g)).toHaveLength(2); // solo rg-rows y el script propio
    const json = /<script id="rg-rows" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(() => JSON.parse(json)).not.toThrow();
    expect(Object.values(JSON.parse(json) as Record<string, { title: string }>)[0]!.title).toBe(payload);
  });

  it('el atributo alt e id no se pueden inyectar (gifId con comillas)', async () => {
    const html = await buildHtml([row({ gifId: 'a" onclick="alert(1)' })]);
    expect(html).not.toMatch(/data-id="a" onclick/);
    expect(html).toContain('data-id="a&quot; onclick=&quot;alert(1)"');
  });

  it('los enlaces externos llevan rel=noopener noreferrer', async () => {
    const html = await buildHtml([row()]);
    for (const a of html.match(/<a [^>]*target="_blank"[^>]*>/g) ?? []) expect(a).toContain('rel="noopener noreferrer"');
  });

  it('descarga imágenes con concurrencia máxima de 6', async () => {
    let active = 0;
    let peak = 0;
    installFetch(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } });
    });
    await buildHtml(Array.from({ length: 40 }, (_, i) => row({ id: i, gifId: `g${i}`, imageUrl: `https://media.redgifs.com/${i}.jpg` })));
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });

  it('lista vacía: documento válido con 0 filas', async () => {
    const html = await buildHtml([]);
    expect(html).toContain('<tbody>\n\n</tbody>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });
});
