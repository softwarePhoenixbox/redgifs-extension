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
  image_url  TEXT,
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
  await migrate(db);
  return db;
}

// Bases guardadas con la versión anterior no tienen la columna image_url
async function migrate(db: Database): Promise<void> {
  const columns = db.exec('PRAGMA table_info(links)')[0]?.values.map(row => row[1]) ?? [];
  if (columns.includes('image_url')) return;
  db.run('ALTER TABLE links ADD COLUMN image_url TEXT');
  // Rellena las filas viejas con el patrón <Nombre>-mobile.jpg
  db.run("UPDATE links SET image_url = replace(url, '.mp4', '-mobile.jpg') WHERE url LIKE '%.mp4'");
  await persist(db);
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
  imageUrl?: string;
  pageUrl: string;
}

export function saveLink({ gifId, url, imageUrl, pageUrl }: SaveLinkInput) {
  return enqueue(async db => {
    const existing = db.exec('SELECT image_url FROM links WHERE gif_id = ?', [gifId]);
    const row = existing[0]?.values[0];
    let inserted = false;
    let changed = false;

    if (!row) {
      db.run('INSERT INTO links (gif_id, url, image_url, page_url) VALUES (?, ?, ?, ?)', [
        gifId,
        url,
        imageUrl ?? null,
        pageUrl,
      ]);
      inserted = changed = true;
    } else if (imageUrl && !row[0]) {
      // Link ya guardado sin imagen: se completa
      db.run('UPDATE links SET image_url = ? WHERE gif_id = ?', [imageUrl, gifId]);
      changed = true;
    }

    if (changed) await persist(db);
    return { inserted, total: countRows(db) };
  });
}

export function getTotal(): Promise<number> {
  return enqueue(db => countRows(db));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// El archivo .sqlite completo, en base64 (para mandarlo por mensaje).
export function exportDbBase64(): Promise<string> {
  return enqueue(db => bytesToBase64(db.export()));
}

export interface LinkRow {
  id: number;
  gifId: string;
  url: string;
  imageUrl: string | null;
  pageUrl: string | null;
  createdAt: string;
}

export function listLinks(): Promise<LinkRow[]> {
  return enqueue(db => {
    const res = db.exec(
      'SELECT id, gif_id, url, image_url, page_url, created_at FROM links ORDER BY id',
    );
    return (res[0]?.values ?? []).map(r => ({
      id: Number(r[0]),
      gifId: String(r[1]),
      url: String(r[2]),
      imageUrl: r[3] === null ? null : String(r[3]),
      pageUrl: r[4] === null ? null : String(r[4]),
      createdAt: String(r[5]),
    }));
  });
}