export interface Mp4Metadata {
  title?: string | null;
  author?: string | null;
  tags?: string[];
  pageUrl?: string | null;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, false);
}

interface Mp4Box { type: string; start: number; size: number }

function children(bytes: Uint8Array, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size = readU32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (size === 0) {
      boxes.push({ type, start: offset, size: end - offset });
      break;
    }
    if (size < 8 || offset + size > end) throw new Error(`MP4 inválido: box ${type}`);
    boxes.push({ type, start: offset, size });
    offset += size;
  }
  return boxes;
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(8 + payload.length);
  writeU32(result, 0, result.length);
  for (let i = 0; i < 4; i++) result[4 + i] = type.charCodeAt(i);
  result.set(payload, 8);
  return result;
}

function utf16leZ(value: string): Uint8Array {
  const result = new Uint8Array((value.length + 1) * 2);
  const view = new DataView(result.buffer);
  for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), true);
  return result;
}

function xtraEntry(name: string, value: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const valueBytes = utf16leZ(value);
  const result = new Uint8Array(18 + nameBytes.length + valueBytes.length);
  const view = new DataView(result.buffer);
  let offset = 0;
  view.setUint32(offset, result.length, false); offset += 4;
  view.setUint32(offset, nameBytes.length, false); offset += 4;
  result.set(nameBytes, offset); offset += nameBytes.length;
  view.setUint32(offset, 1, false); offset += 4;
  view.setUint32(offset, valueBytes.length + 6, false); offset += 4;
  view.setUint16(offset, 8, false); offset += 2;
  result.set(valueBytes, offset);
  return result;
}

function xtraPayload(metadata: Mp4Metadata): Uint8Array {
  const fields: Array<[string, string]> = [];
  if (metadata.title?.trim()) fields.push(['WM/Title', metadata.title.trim()]);
  if (metadata.author?.trim()) fields.push(['WM/Author', metadata.author.trim()]);
  const tags = metadata.tags?.map(tag => tag.trim()).filter(Boolean).join(' ');
  if (tags) fields.push(['WM/Category', tags]);
  if (metadata.pageUrl?.trim()) fields.push(['WM/PromotionURL', metadata.pageUrl.trim()]);
  const entries = fields.map(([name, value]) => xtraEntry(name, value));
  const result = new Uint8Array(entries.reduce((sum, entry) => sum + entry.length, 0));
  let offset = 0;
  for (const entry of entries) { result.set(entry, offset); offset += entry.length; }
  return result;
}

function quickTimeTextItem(type: string, value: string): Uint8Array {
  const valueBytes = new TextEncoder().encode(value);
  const data = new Uint8Array(16 + valueBytes.length);
  writeU32(data, 0, data.length);
  data.set([100, 97, 116, 97], 4); // data
  writeU32(data, 8, 1); // UTF-8 text
  data.set(valueBytes, 16);
  return box(type, data);
}

function quickTimePayload(metadata: Mp4Metadata): Uint8Array {
  const items: Uint8Array[] = [];
  if (metadata.title?.trim()) items.push(quickTimeTextItem('©nam', metadata.title.trim()));
  if (metadata.author?.trim()) items.push(quickTimeTextItem('©ART', metadata.author.trim()));
  if (!items.length) return new Uint8Array();

  const ilstPayload = new Uint8Array(items.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const item of items) { ilstPayload.set(item, offset); offset += item.length; }
  const ilst = box('ilst', ilstPayload);
  const hdlr = new Uint8Array(33);
  writeU32(hdlr, 0, hdlr.length);
  hdlr.set([104, 100, 108, 114], 4); // hdlr
  hdlr.set([109, 100, 105, 114], 16); // mdir
  const metaPayload = new Uint8Array(4 + hdlr.length + ilst.length);
  metaPayload.set(hdlr, 4);
  metaPayload.set(ilst, 4 + hdlr.length);
  return box('meta', metaPayload);
}

function findChunkTables(bytes: Uint8Array, start: number, end: number): Mp4Box[] {
  const found: Mp4Box[] = [];
  for (const child of children(bytes, start, end)) {
    if (child.type === 'stco' || child.type === 'co64') found.push(child);
    if (['trak', 'mdia', 'minf', 'stbl'].includes(child.type)) {
      found.push(...findChunkTables(bytes, child.start + 8, child.start + child.size));
    }
  }
  return found;
}

function patchChunkOffsets(bytes: Uint8Array, table: Mp4Box, delta: number): void {
  const count = readU32(bytes, table.start + 12);
  const entrySize = table.type === 'stco' ? 4 : 8;
  let offset = table.start + 16;
  for (let i = 0; i < count; i++, offset += entrySize) {
    if (table.type === 'stco') {
      writeU32(bytes, offset, readU32(bytes, offset) + delta);
    } else {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      view.setBigUint64(offset, view.getBigUint64(offset, false) + BigInt(delta), false);
    }
  }
}

function injectUdtaBox(bytes: Uint8Array, type: string, atom: Uint8Array): Uint8Array {
  if (!atom.length) return bytes;
  const top = children(bytes, 0, bytes.length);
  const moov = top.find(item => item.type === 'moov');
  if (!moov) throw new Error('El MP4 no contiene el box moov');
  const mdat = top.find(item => item.type === 'mdat');
  const moovChildren = children(bytes, moov.start + 8, moov.start + moov.size);
  const udta = moovChildren.find(item => item.type === 'udta');

  let insertAt: number;
  let removeLength = 0;
  let inserted = atom;
  if (udta) {
    const existing = children(bytes, udta.start + 8, udta.start + udta.size).find(item => item.type === type);
    insertAt = existing?.start ?? udta.start + udta.size;
    removeLength = existing?.size ?? 0;
  } else {
    inserted = box('udta', atom);
    insertAt = moov.start + moov.size;
  }

  const delta = inserted.length - removeLength;
  const output = new Uint8Array(bytes.length + delta);
  output.set(bytes.subarray(0, insertAt));
  output.set(inserted, insertAt);
  output.set(bytes.subarray(insertAt + removeLength), insertAt + inserted.length);
  if (udta) writeU32(output, udta.start, udta.size + delta);
  writeU32(output, moov.start, moov.size + delta);

  if (mdat && moov.start < mdat.start && delta !== 0) {
    for (const table of findChunkTables(output, moov.start + 8, moov.start + moov.size + delta)) {
      patchChunkOffsets(output, table, delta);
    }
  }
  return output;
}

export function embedMp4Metadata(input: Uint8Array, metadata: Mp4Metadata): Uint8Array {
  const xtra = xtraPayload(metadata);
  if (!xtra.length) throw new Error('No hay título, autor, etiquetas ni URL para incrustar');
  let output = injectUdtaBox(input, 'Xtra', box('Xtra', xtra));
  output = injectUdtaBox(output, 'meta', quickTimePayload(metadata));
  return output;
}
