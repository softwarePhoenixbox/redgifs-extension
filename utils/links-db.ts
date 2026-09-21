import initSqlJs, { type Database } from 'sql.js';
// Vite copia el .wasm como asset de la extensión y nos da su URL.
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';

// La base SQLite vive en memoria (sql.js) y su archivo completo se guarda en
// IndexedDB después de cada cambio, así sobrevive a reinicios del navegador y
// del service worker.
const IDB_NAME = 'rg-links-db';
const IDB_STORE = 'kv';
const IDB_KEY = 'sqlite-file';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  gif_id     TEXT NOT NULL UNIQUE,
  url        TEXT NOT NULL,
  page_url   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_links_created_at ON links (created_at);
`;

// ---------- IndexedDB (solo guarda el archivo .sqlite como bytes) ----------
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<Uint8Array | undefined> {
  const idb = await idbOpen();
  try {
    return await new Promise<Uint8Array | undefined>((resolve, reject) => {
      const req = idb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result as Uint8Array | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    idb.close();
  }
}

async function idbSet(key: string, value: Uint8Array): Promise<void> {
  const idb = await idbOpen();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    idb.close();
  }
}

// ---------- SQLite ----------
let dbPromise: Promise<Database> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function openDb(): Promise<Database> {
  const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
  const SQL = await initSqlJs({ wasmBinary });
  const saved = await idbGet(IDB_KEY);
  const db = saved ? new SQL.Database(saved) : new SQL.Database();
  db.run(SCHEMA);
  return db;
}

function getDb(): Promise<Database> {
  dbPromise ??= openDb().catch(err => {
    dbPromise = null; // permite reintentar si falló la primera vez
    throw err;
  });
  return dbPromise;
}

// Todas las operaciones se ejecutan de una en una (el background recibe
// mensajes en paralelo y la base es una sola).
function enqueue<T>(job: (db: Database) => Promise<T> | T): Promise<T> {
  const run = queue.then(async () => job(await getDb()));
  queue = run.catch(() => undefined);
  return run;
}

async function persist(db: Database): Promise<void> {
  await idbSet(IDB_KEY, db.export());
}

function countRows(db: Database): number {
  const res = db.exec('SELECT COUNT(*) FROM links');
  return Number(res[0]?.values[0]?.[0] ?? 0);
}

// ---------- API pública ----------
export interface SaveLinkInput {
  gifId: string;
  url: string;
  pageUrl: string;
}

export function saveLink({ gifId, url, pageUrl }: SaveLinkInput) {
  return enqueue(async db => {
    db.run('INSERT OR IGNORE INTO links (gif_id, url, page_url) VALUES (?, ?, ?)', [
      gifId,
      url,
      pageUrl,
    ]);
    const inserted = db.getRowsModified() > 0;
    if (inserted) await persist(db);
    return { inserted, total: countRows(db) };
  });
}

export function getTotal(): Promise<number> {
  return enqueue(db => countRows(db));
}

// El archivo .sqlite completo, en base64 (para mandarlo por mensaje).
export function exportDbBase64(): Promise<string> {
  return enqueue(db => {
    const bytes = db.export();
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  });
}