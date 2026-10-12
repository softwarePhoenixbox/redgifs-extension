// Construye MP4 sintéticos mínimos (no reproducibles, pero estructuralmente válidos) para probar el parser de cajas.
export const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
export const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
export const box = (type: string, ...payload: Uint8Array[]) => {
  const body = cat(...payload);
  return cat(u32(8 + body.length), new TextEncoder().encode(type), body);
};
export function u64(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n));
  return b;
}

export const MDAT_MARK = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4]);

/** stco/co64 con offsets ABSOLUTOS que apuntan a MDAT_MARK dentro de mdat. */
export function buildMp4(opts: { moovFirst?: boolean; co64?: boolean; withUdta?: boolean; noMoov?: boolean } = {}): { bytes: Uint8Array; chunkOffset: () => number } {
  const { moovFirst = true, co64 = false, withUdta = false, noMoov = false } = opts;
  const ftyp = box('ftyp', new TextEncoder().encode('isom'), u32(512), new TextEncoder().encode('isomiso2'));
  const mdat = box('mdat', MDAT_MARK);
  const build = (chunkOffset: number) => {
    const table = co64
      ? box('co64', u32(0), u32(1), u64(chunkOffset))
      : box('stco', u32(0), u32(1), u32(chunkOffset));
    const trak = box('trak', box('mdia', box('minf', box('stbl', table))));
    const mvhd = box('mvhd', new Uint8Array(100));
    const udta = withUdta ? box('udta', box('free', new Uint8Array(12))) : new Uint8Array();
    return box('moov', mvhd, trak, udta);
  };
  if (noMoov) return { bytes: cat(ftyp, mdat), chunkOffset: () => 0 };
  const moovLen = build(0).length;
  if (moovFirst) {
    const offset = ftyp.length + moovLen + 8; // 8 = cabecera de mdat
    return { bytes: cat(ftyp, build(offset), mdat), chunkOffset: () => offset };
  }
  const offset = ftyp.length + 8;
  return { bytes: cat(ftyp, mdat, build(offset)), chunkOffset: () => offset };
}

export interface ParsedBox { type: string; start: number; size: number }
export function parseBoxes(bytes: Uint8Array, start = 0, end = bytes.length): ParsedBox[] {
  const out: ParsedBox[] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = start;
  while (o + 8 <= end) {
    const size = dv.getUint32(o);
    out.push({ type: String.fromCharCode(...bytes.subarray(o + 4, o + 8)), start: o, size });
    o += size;
  }
  return out;
}

/** Lee el primer offset de stco/co64 buscando recursivamente. */
export function readChunkOffset(bytes: Uint8Array): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const walk = (s: number, e: number): number | null => {
    for (const b of parseBoxes(bytes, s, e)) {
      if (b.type === 'stco') return dv.getUint32(b.start + 16);
      if (b.type === 'co64') return Number(dv.getBigUint64(b.start + 16));
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(b.type)) {
        const r = walk(b.start + 8, b.start + b.size);
        if (r !== null) return r;
      }
    }
    return null;
  };
  const r = walk(0, bytes.length);
  if (r === null) throw new Error('sin stco/co64');
  return r;
}

export function indexOfSeq(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Decodifica las entradas WM/* del átomo Xtra. */
export function readXtra(bytes: Uint8Array): Record<string, string> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = parseBoxes(bytes).find(b => b.type === 'moov')!;
  const udta = parseBoxes(bytes, moov.start + 8, moov.start + moov.size).find(b => b.type === 'udta');
  if (!udta) return {};
  const xtra = parseBoxes(bytes, udta.start + 8, udta.start + udta.size).find(b => b.type === 'Xtra');
  if (!xtra) return {};
  const res: Record<string, string> = {};
  let o = xtra.start + 8;
  const end = xtra.start + xtra.size;
  while (o < end) {
    const size = dv.getUint32(o);
    const nameLen = dv.getUint32(o + 4);
    const name = new TextDecoder().decode(bytes.subarray(o + 8, o + 8 + nameLen));
    const valLen = dv.getUint32(o + 8 + nameLen + 4);
    const valStart = o + 8 + nameLen + 8 + 2;
    const raw = bytes.subarray(valStart, valStart + valLen - 6);
    res[name] = new TextDecoder('utf-16le').decode(raw).replace(/\0$/, '');
    o += size;
  }
  return res;
}
