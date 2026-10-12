import { describe, expect, it } from 'vitest';
import { embedMp4Metadata } from '../utils/mp4-metadata';
import { MDAT_MARK, buildMp4, cat, box, indexOfSeq, parseBoxes, readChunkOffset, readXtra, u32 } from './helpers/mp4';

const META = { title: 'Mi título', author: 'autor', tags: ['#a', '#b'], pageUrl: 'https://www.redgifs.com/watch/x' };

function expectStructurallyValid(bytes: Uint8Array) {
  const top = parseBoxes(bytes);
  // Los tamaños de las cajas de primer nivel deben cubrir el archivo exacto.
  expect(top.reduce((s, b) => s + b.size, 0)).toBe(bytes.length);
  const moov = top.find(b => b.type === 'moov')!;
  const kids = parseBoxes(bytes, moov.start + 8, moov.start + moov.size);
  expect(kids.reduce((s, b) => s + b.size, 8)).toBe(moov.size);
}

describe('embedMp4Metadata', () => {
  it('conserva el tamaño total coherente y deja intacto el mdat', () => {
    const { bytes } = buildMp4();
    const out = embedMp4Metadata(bytes, META);
    expect(out.length).toBeGreaterThan(bytes.length);
    expectStructurallyValid(out);
    expect(indexOfSeq(out, MDAT_MARK)).toBeGreaterThan(0);
  });

  it('desplaza stco cuando moov está antes de mdat: el offset sigue apuntando a los mismos bytes', () => {
    const { bytes, chunkOffset } = buildMp4({ moovFirst: true });
    const out = embedMp4Metadata(bytes, META);
    const off = readChunkOffset(out);
    expect(off).toBe(chunkOffset() + (out.length - bytes.length));
    expect([...out.subarray(off, off + MDAT_MARK.length)]).toEqual([...MDAT_MARK]);
  });

  it('también desplaza co64 (archivos grandes)', () => {
    const { bytes } = buildMp4({ co64: true });
    const out = embedMp4Metadata(bytes, META);
    const off = readChunkOffset(out);
    expect([...out.subarray(off, off + MDAT_MARK.length)]).toEqual([...MDAT_MARK]);
  });

  it('NO toca los offsets cuando moov va después de mdat (faststart ausente)', () => {
    const { bytes, chunkOffset } = buildMp4({ moovFirst: false });
    const out = embedMp4Metadata(bytes, META);
    expect(readChunkOffset(out)).toBe(chunkOffset());
    expect([...out.subarray(chunkOffset(), chunkOffset() + MDAT_MARK.length)]).toEqual([...MDAT_MARK]);
    expectStructurallyValid(out);
  });

  it('reutiliza un udta existente sin duplicarlo', () => {
    const { bytes } = buildMp4({ withUdta: true });
    const out = embedMp4Metadata(bytes, META);
    const moov = parseBoxes(out).find(b => b.type === 'moov')!;
    const udtas = parseBoxes(out, moov.start + 8, moov.start + moov.size).filter(b => b.type === 'udta');
    expect(udtas).toHaveLength(1);
    expectStructurallyValid(out);
    const off = readChunkOffset(out);
    expect([...out.subarray(off, off + MDAT_MARK.length)]).toEqual([...MDAT_MARK]);
  });

  it('escribe los campos Xtra de Windows (título, autor, tags, URL) recortando espacios', () => {
    const out = embedMp4Metadata(buildMp4().bytes, { title: '  Mi título ', author: ' autor', tags: [' #a ', '', '#b'], pageUrl: ' https://x.test/ ' });
    expect(readXtra(out)).toEqual({
      'WM/Title': 'Mi título',
      'WM/Author': 'autor',
      'WM/Category': '#a #b',
      'WM/PromotionURL': 'https://x.test/',
    });
  });

  it('soporta Unicode fuera del BMP (emoji) y acentos', () => {
    const out = embedMp4Metadata(buildMp4().bytes, { title: 'Ñandú 🔥 日本語' });
    expect(readXtra(out)['WM/Title']).toBe('Ñandú 🔥 日本語');
  });

  it('es idempotente en contenido: reincrustar reemplaza Xtra en lugar de acumular', () => {
    const once = embedMp4Metadata(buildMp4().bytes, META);
    const twice = embedMp4Metadata(once, { title: 'Otro' });
    expect(readXtra(twice)).toEqual({ 'WM/Title': 'Otro' });
    expectStructurallyValid(twice);
    const off = readChunkOffset(twice);
    expect([...twice.subarray(off, off + MDAT_MARK.length)]).toEqual([...MDAT_MARK]);
  });

  it('incrusta ©nam/©ART de QuickTime solo con título o autor', () => {
    const tag = (n: string) => new Uint8Array([0xa9, ...new TextEncoder().encode(n)]);
    const withBoth = embedMp4Metadata(buildMp4().bytes, { title: 'T', author: 'A' });
    expect(indexOfSeq(withBoth, tag('nam'))).toBeGreaterThan(0);
    expect(indexOfSeq(withBoth, tag('ART'))).toBeGreaterThan(0);
    const onlyTags = embedMp4Metadata(buildMp4().bytes, { tags: ['#x'] });
    expect(indexOfSeq(onlyTags, tag('nam'))).toBe(-1);
    expectStructurallyValid(withBoth);
  });

  it('no modifica el buffer de entrada', () => {
    const { bytes } = buildMp4();
    const copy = bytes.slice();
    embedMp4Metadata(bytes, META);
    expect([...bytes]).toEqual([...copy]);
  });

  it('rechaza metadatos vacíos', () => {
    expect(() => embedMp4Metadata(buildMp4().bytes, {})).toThrow(/No hay/);
    expect(() => embedMp4Metadata(buildMp4().bytes, { title: '   ', tags: ['', ' '], author: null, pageUrl: '' })).toThrow(/No hay/);
  });

  it('rechaza un MP4 sin moov', () => {
    expect(() => embedMp4Metadata(buildMp4({ noMoov: true }).bytes, META)).toThrow(/moov/);
  });

  it('rechaza cajas corruptas (tamaño mayor al archivo) en vez de leer fuera de rango', () => {
    const { bytes } = buildMp4();
    const corrupt = bytes.slice(0, bytes.length - 3); // mdat truncado
    expect(() => embedMp4Metadata(corrupt, META)).toThrow(/MP4 inválido/);
  });

  it('rechaza una caja con tamaño < 8 (bucle infinito si no se valida)', () => {
    const bad = cat(box('ftyp', new Uint8Array(8)), u32(4), new TextEncoder().encode('moov'));
    expect(() => embedMp4Metadata(bad, META)).toThrow(/MP4 inválido/);
  });
});
