import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';

const WASM = new URL('../../node_modules/sql.js/dist/sql-wasm-browser.wasm', import.meta.url);

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** fetch falso: el .wasm de sql.js se sirve desde node_modules; el resto lo decide `handler` (por defecto 404). */
export function installFetch(handler: Handler = () => new Response('', { status: 404 })) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('.wasm')) return new Response(readFileSync(WASM), { headers: { 'content-type': 'application/wasm' } });
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** IndexedDB nuevo y vacío (cada prueba tiene su "perfil" de navegador). */
export function freshIndexedDb(): IDBFactory {
  const idb = new IDBFactory();
  vi.stubGlobal('indexedDB', idb);
  return idb;
}

/** Escribe un archivo .sqlite crudo donde links-db espera encontrarlo (simula una base guardada por una versión antigua). */
export function seedSqliteFile(idb: IDBFactory, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = idb.open('rg-links-db', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(bytes, 'sqlite-file');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}
