import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshIndexedDb, installFetch, seedSqliteFile } from './helpers/env';

type Db = typeof import('../utils/links-db');
let idb: ReturnType<typeof freshIndexedDb>;

/** "Reinicia el service worker": mismo IndexedDB, módulo nuevo. */
async function load(): Promise<Db> {
  vi.resetModules();
  return import('../utils/links-db');
}
const base = { gifId: 'abc', url: 'https://media.redgifs.com/abc.mp4', pageUrl: 'https://www.redgifs.com/watch/abc' };

async function sqlJs() {
  return initSqlJs({ wasmBinary: readFileSync(new URL('../node_modules/sql.js/dist/sql-wasm-browser.wasm', import.meta.url)) as unknown as ArrayBuffer });
}

beforeEach(() => {
  idb = freshIndexedDb();
  installFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe('saveLink', () => {
  it('inserta y cuenta; guardar el mismo gifId no duplica', async () => {
    const db = await load();
    expect(await db.saveLink(base)).toEqual({ inserted: true, total: 1 });
    expect(await db.saveLink(base)).toEqual({ inserted: false, total: 1 });
    expect(await db.linkExists('abc')).toBe(true);
    expect(await db.linkExists('zzz')).toBe(false);
  });

  it('el reguardado completa imagen/título/autor solo si faltaban y NO pisa los existentes', async () => {
    const db = await load();
    await db.saveLink({ ...base, title: 'Original', author: 'A' });
    await db.saveLink({ ...base, title: 'Nuevo', author: 'B', imageUrl: 'https://media.redgifs.com/abc.jpg' });
    const [row] = await db.listLinks();
    expect(row).toMatchObject({ title: 'Original', author: 'A', imageUrl: 'https://media.redgifs.com/abc.jpg' });
  });

  it('tags/vistas/likes se refrescan siempre, pero un guardado sin ellos no los borra', async () => {
    const db = await load();
    await db.saveLink({ ...base, tags: ['#a'], views: '10', likes: '1' });
    await db.saveLink({ ...base, tags: ['#a', '#b'], views: '99', likes: '5' });
    await db.saveLink({ ...base, tags: [], views: undefined, likes: undefined });
    expect(await db.listLinks()).toEqual([expect.objectContaining({ tags: ['#a', '#b'], views: '99', likes: '5' })]);
  });

  it('reportar inserted=false con cambios: sigue siendo "no insertado" (el popup dice "ya guardado")', async () => {
    const db = await load();
    await db.saveLink(base);
    expect((await db.saveLink({ ...base, views: '5' })).inserted).toBe(false);
  });

  it('valores con comillas y SQL se guardan como datos (consultas parametrizadas)', async () => {
    const db = await load();
    const evil = `x'); DROP TABLE links;--`;
    await db.saveLink({ ...base, gifId: evil, title: `"; DELETE FROM links; --` });
    expect(await db.getTotal()).toBe(1);
    expect((await db.listLinks())[0]).toMatchObject({ gifId: evil });
    expect(await db.linkExists(evil)).toBe(true);
  });

  it('Unicode y emoji sobreviven al viaje completo', async () => {
    const db = await load();
    await db.saveLink({ ...base, title: 'Ñandú 🔥 日本語', tags: ['#ñ'] });
    expect((await db.listLinks())[0]).toMatchObject({ title: 'Ñandú 🔥 日本語', tags: ['#ñ'] });
  });

  it('50 guardados concurrentes distintos no pierden filas', async () => {
    const db = await load();
    await Promise.all(Array.from({ length: 50 }, (_, i) => db.saveLink({ ...base, gifId: `id${i}` })));
    expect(await db.getTotal()).toBe(50);
  });

  it('el mismo gifId en paralelo se inserta exactamente una vez', async () => {
    const db = await load();
    const results = await Promise.all(Array.from({ length: 10 }, () => db.saveLink(base)));
    expect(results.filter(r => r.inserted)).toHaveLength(1);
    expect(await db.getTotal()).toBe(1);
  });
});

describe('persistencia', () => {
  it('los datos sobreviven al reinicio del service worker (módulo nuevo, mismo IndexedDB)', async () => {
    const a = await load();
    await a.saveLink({ ...base, title: 'T', tags: ['#x'] });
    const b = await load();
    expect(await b.listLinks()).toEqual([expect.objectContaining({ gifId: 'abc', title: 'T', tags: ['#x'] })]);
  });

  it('borrar también persiste', async () => {
    const a = await load();
    await a.saveLink(base);
    expect(await a.deleteLink('abc')).toBe(0);
    expect(await (await load()).getTotal()).toBe(0);
  });

  it('borrar un id inexistente no falla y devuelve el total', async () => {
    const db = await load();
    await db.saveLink(base);
    expect(await db.deleteLink('nope')).toBe(1);
  });
});

describe('migración de bases antiguas', () => {
  it('agrega columnas nuevas y rellena image_url de filas viejas sin tocar los datos', async () => {
    const SQL = await sqlJs();
    const old = new SQL.Database();
    old.run('CREATE TABLE links (id INTEGER PRIMARY KEY AUTOINCREMENT, gif_id TEXT NOT NULL UNIQUE, url TEXT NOT NULL, page_url TEXT, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
    old.run("INSERT INTO links (gif_id, url, page_url) VALUES ('old1', 'https://media.redgifs.com/old1.mp4', 'https://www.redgifs.com/watch/old1')");
    old.run("INSERT INTO links (gif_id, url, page_url) VALUES ('old2', 'https://media.redgifs.com/old2.webm', NULL)");
    await seedSqliteFile(idb, old.export());

    const db = await load();
    const rows = await db.listLinks();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ gifId: 'old1', imageUrl: 'https://media.redgifs.com/old1-mobile.jpg', title: null, tags: [] });
    expect(rows[1]).toMatchObject({ gifId: 'old2', imageUrl: null, pageUrl: null });
    // y se puede seguir guardando con el esquema nuevo
    expect((await db.saveLink({ ...base, title: 'nuevo' })).total).toBe(3);
  });

  it('tags corruptos en la base no rompen el listado', async () => {
    const SQL = await sqlJs();
    const d = new SQL.Database();
    d.run('CREATE TABLE links (id INTEGER PRIMARY KEY AUTOINCREMENT, gif_id TEXT NOT NULL UNIQUE, url TEXT NOT NULL, image_url TEXT, page_url TEXT, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')), title TEXT, author TEXT, tags TEXT, views TEXT, likes TEXT)');
    d.run("INSERT INTO links (gif_id, url, tags) VALUES ('a','https://x/a.mp4','{no json'), ('b','https://x/b.mp4','{\"no\":\"array\"}'), ('c','https://x/c.mp4','[1,\"2\"]')");
    await seedSqliteFile(idb, d.export());
    const rows = await (await load()).listLinks();
    expect(rows.map(r => r.tags)).toEqual([[], [], ['1', '2']]);
  });
});

describe('exportar / importar', () => {
  async function seedDb(rows: Array<Parameters<Db['saveLink']>[0]>): Promise<Uint8Array> {
    const idb2 = freshIndexedDb();
    void idb2;
    const m = await load();
    for (const r of rows) await m.saveLink(r);
    const bytes = Uint8Array.from(atob(await m.exportDbBase64()), c => c.charCodeAt(0));
    return bytes;
  }

  it('round-trip: lo exportado en un perfil se importa completo en otro', async () => {
    const file = await seedDb([
      { ...base, gifId: 'a', title: 'A', tags: ['#1'] },
      { ...base, gifId: 'b', author: 'B', views: '7' },
    ]);
    freshIndexedDb();
    const target = await load();
    expect(await target.importDb(file)).toEqual({ imported: 2, updated: 0, total: 2 });
    expect((await target.listLinks()).map(r => r.gifId)).toEqual(['a', 'b']);
  });

  it('fusiona sin duplicar: reimportar el mismo archivo no cambia nada', async () => {
    const file = await seedDb([{ ...base, gifId: 'a', title: 'A' }]);
    freshIndexedDb();
    const target = await load();
    await target.importDb(file);
    expect(await target.importDb(file)).toEqual({ imported: 0, updated: 0, total: 1 });
  });

  it('cuenta como actualizadas las filas existentes que ganan datos', async () => {
    const file = await seedDb([{ ...base, gifId: 'a', title: 'T', views: '10' }]);
    freshIndexedDb();
    const target = await load();
    await target.saveLink({ ...base, gifId: 'a' });
    expect(await target.importDb(file)).toEqual({ imported: 0, updated: 1, total: 1 });
    expect((await target.listLinks())[0]).toMatchObject({ title: 'T', views: '10' });
  });

  it('un archivo que no es SQLite se rechaza con mensaje claro y no altera la base', async () => {
    const db = await load();
    await db.saveLink(base);
    await expect(db.importDb(new TextEncoder().encode('esto no es sqlite, ni de lejos'))).rejects.toThrow(/válida|tabla/);
    expect(await db.getTotal()).toBe(1);
  });

  it('un .sqlite válido pero sin tabla links se rechaza', async () => {
    const SQL = await sqlJs();
    const d = new SQL.Database();
    d.run('CREATE TABLE otra (x)');
    const db = await load();
    await expect(db.importDb(d.export())).rejects.toThrow(/tabla "links"/);
  });

  it('una importación fallida no deja la cola bloqueada para las siguientes operaciones', async () => {
    const db = await load();
    await expect(db.importDb(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    expect((await db.saveLink(base)).inserted).toBe(true);
  });

  it('page_url NULL en el archivo importado queda como cadena vacía (no "null")', async () => {
    const SQL = await sqlJs();
    const d = new SQL.Database();
    d.run('CREATE TABLE links (gif_id TEXT, url TEXT, image_url TEXT, page_url TEXT, title TEXT, author TEXT, tags TEXT, views TEXT, likes TEXT)');
    d.run("INSERT INTO links (gif_id, url) VALUES ('z', 'https://x/z.mp4')");
    const db = await load();
    await db.importDb(d.export());
    expect((await db.listLinks())[0]!.pageUrl).toBe('');
  });
});

describe('bytesToBase64', () => {
  it('codifica correctamente por trozos (más de 0x8000 bytes) sin desbordar la pila', async () => {
    const { bytesToBase64 } = await load();
    const big = new Uint8Array(300_000).map((_, i) => i % 251);
    const back = Uint8Array.from(atob(bytesToBase64(big)), c => c.charCodeAt(0));
    expect(back.length).toBe(big.length);
    expect(back[299_999]).toBe(big[299_999]);
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });
});

describe('recuperación de errores', () => {
  it('si la primera apertura de la base falla, la siguiente operación reintenta', async () => {
    const db = await load();
    const spy = vi.spyOn(idb, 'open').mockImplementationOnce(() => { throw new Error('IDB no disponible'); });
    await expect(db.getTotal()).rejects.toThrow('IDB no disponible');
    spy.mockRestore();
    expect(await db.getTotal()).toBe(0);
  });

  // HALLAZGO (baja gravedad): getSql() cachea la promesa aunque falle. Si el fetch del .wasm falla UNA vez
  // (p. ej. el service worker arrancando con el disco ocupado), initSqlJs queda rechazado para siempre y la base
  // no se puede abrir hasta que el navegador reinicie el service worker. dbPromise sí se resetea, sqlPromise no.
  it.fails('un fallo transitorio al cargar el .wasm no debe envenenar las operaciones posteriores', async () => {
    let calls = 0;
    const wasm = readFileSync(new URL('../node_modules/sql.js/dist/sql-wasm-browser.wasm', import.meta.url));
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (calls++ === 0) throw new TypeError('Failed to fetch');
      return new Response(wasm);
    }));
    const db = await load();
    await expect(db.getTotal()).rejects.toThrow();
    expect(await db.getTotal()).toBe(0);
  });
});
