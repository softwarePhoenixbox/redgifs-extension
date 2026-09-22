import initSqlJs, {
  type Database,
  type SqlValue,
} from 'sql.js';
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

// Columnas añadidas después de la primera versión. Se agregan solas si faltan
// (ver migrate()), sin tocar las bases ya guardadas en IndexedDB.
const EXTRA_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'image_url', ddl: 'ALTER TABLE links ADD COLUMN image_url TEXT' },
  { name: 'title', ddl: 'ALTER TABLE links ADD COLUMN title TEXT' },
  { name: 'author', ddl: 'ALTER TABLE links ADD COLUMN author TEXT' },
  { name: 'tags', ddl: 'ALTER TABLE links ADD COLUMN tags TEXT' }, // JSON.stringify(string[])
  { name: 'views', ddl: 'ALTER TABLE links ADD COLUMN views TEXT' },
  { name: 'likes', ddl: 'ALTER TABLE links ADD COLUMN likes TEXT' },
];

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
let sqlPromise: ReturnType<typeof initSqlJs> | null = null;

// Se carga una sola vez y se reutiliza tanto para la base principal como
// para leer archivos .db/.sqlite importados desde otro navegador.
function getSql() {
  sqlPromise ??= (async () => {
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
    return initSqlJs({ wasmBinary });
  })();
  return sqlPromise;
}

async function openDb(): Promise<Database> {
  const SQL = await getSql();
  const saved = await idbGet(IDB_KEY);
  const db = saved ? new SQL.Database(saved) : new SQL.Database();
  db.run(SCHEMA);
  await migrate(db);
  return db;
}

// Bases guardadas con versiones anteriores no tienen todas las columnas.
async function migrate(db: Database): Promise<void> {
  const columns = new Set(
    (db.exec('PRAGMA table_info(links)')[0]?.values.map(row => String(row[1])) ?? []),
  );
  let addedImageUrl = false;
  for (const { name, ddl } of EXTRA_COLUMNS) {
    if (columns.has(name)) continue;
    db.run(ddl);
    if (name === 'image_url') addedImageUrl = true;
  }
  if (addedImageUrl) {
    // Rellena las filas viejas con el patrón <Nombre>-mobile.jpg
    db.run("UPDATE links SET image_url = replace(url, '.mp4', '-mobile.jpg') WHERE url LIKE '%.mp4'");
  }
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
  title?: string;
  author?: string;
  tags?: string[];
  views?: string;
  likes?: string;
}

// Inserta o actualiza una fila por gif_id (UNIQUE), sin persistir ni
// encolar: eso lo hacen saveLink() e importDb() alrededor de esta función.
// Como gif_id es UNIQUE, nunca se duplica: si ya existe se actualiza
// (tags/vistas/likes siempre se refrescan; imagen/título/autor solo si
// faltaban), y si no existe se inserta.
function upsertRow(
  db: Database,
  { gifId, url, imageUrl, pageUrl, title, author, tags, views, likes }: SaveLinkInput,
): { inserted: boolean; changed: boolean } {
  const tagsJson = tags && tags.length ? JSON.stringify(tags) : null;
  const existing = db.exec('SELECT image_url, title, author FROM links WHERE gif_id = ?', [gifId]);
  const row = existing[0]?.values[0];

  if (!row) {
    db.run(
      `INSERT INTO links (gif_id, url, image_url, page_url, title, author, tags, views, likes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        gifId,
        url,
        imageUrl ?? null,
        pageUrl,
        title ?? null,
        author ?? null,
        tagsJson,
        views ?? null,
        likes ?? null,
      ],
    );
    return { inserted: true, changed: true };
  }

  const [curImage, curTitle, curAuthor] = row;
  const updates: string[] = [];
  const params: SqlValue[] = [];

  // Imagen, título y autor casi no cambian: se completan solo si faltaban.
  if (imageUrl && !curImage) {
    updates.push('image_url = ?');
    params.push(imageUrl);
  }
  if (title && !curTitle) {
    updates.push('title = ?');
    params.push(title);
  }
  if (author && !curAuthor) {
    updates.push('author = ?');
    params.push(author);
  }
  // Tags, vistas y likes se refrescan siempre que se vuelvan a scrapear,
  // porque las vistas/likes cambian con el tiempo.
  if (tagsJson) {
    updates.push('tags = ?');
    params.push(tagsJson);
  }
  if (views) {
    updates.push('views = ?');
    params.push(views);
  }
  if (likes) {
    updates.push('likes = ?');
    params.push(likes);
  }

  if (updates.length) {
    db.run(`UPDATE links SET ${updates.join(', ')} WHERE gif_id = ?`, [...params, gifId]);
    return { inserted: false, changed: true };
  }
  return { inserted: false, changed: false };
}

export function saveLink(input: SaveLinkInput) {
  return enqueue(async db => {
    const { inserted, changed } = upsertRow(db, input);
    if (changed) await persist(db);
    return { inserted, total: countRows(db) };
  });
}

// Fusiona un archivo .sqlite/.db exportado (de otro navegador/perfil) con la
// base local. gif_id es UNIQUE, así que nunca se duplica: fila existente se
// actualiza, fila nueva se inserta. Si el navegador no tenía base propia,
// esto la crea a partir del archivo importado.
export function importDb(bytes: Uint8Array): Promise<{ imported: number; updated: number; total: number }> {
  return enqueue(async db => {
    const SQL = await getSql();
    let importedDb: Database;
    try {
      importedDb = new SQL.Database(bytes);
    } catch {
      throw new Error('El archivo no es una base .sqlite/.db válida');
    }

    let rows: SqlValue[][];
    try {
      rows =
        importedDb.exec(
          'SELECT gif_id, url, image_url, page_url, title, author, tags, views, likes FROM links',
        )[0]?.values ?? [];
    } catch {
      importedDb.close();
      throw new Error('El archivo no tiene una tabla "links" reconocible');
    }
    importedDb.close();

    let imported = 0;
    let updated = 0;
    for (const r of rows) {
      const { inserted, changed } = upsertRow(db, {
        gifId: String(r[0]),
        url: String(r[1]),
        imageUrl: r[2] === null ? undefined : String(r[2]),
        pageUrl: r[3] === null ? '' : String(r[3]),
        title: r[4] === null ? undefined : String(r[4]),
        author: r[5] === null ? undefined : String(r[5]),
        tags: parseTags(r[6]),
        views: r[7] === null ? undefined : String(r[7]),
        likes: r[8] === null ? undefined : String(r[8]),
      });
      if (inserted) imported++;
      else if (changed) updated++;
    }

    if (imported || updated) await persist(db);
    return { imported, updated, total: countRows(db) };
  });
}

export function getTotal(): Promise<number> {
  return enqueue(db => countRows(db));
}

// Borra un link por gif_id (usado desde el popup). Devuelve el total
// restante para refrescar el contador sin otra consulta.
export function deleteLink(gifId: string): Promise<number> {
  return enqueue(async db => {
    db.run('DELETE FROM links WHERE gif_id = ?', [gifId]);
    await persist(db);
    return countRows(db);
  });
}

// Chequea si un gif_id ya está guardado, para mostrar el aviso apenas se
// detecta el video (sin esperar a que el usuario apriete "Guardar").
export function linkExists(gifId: string): Promise<boolean> {
  return enqueue(db => {
    const res = db.exec('SELECT 1 FROM links WHERE gif_id = ? LIMIT 1', [gifId]);
    return (res[0]?.values.length ?? 0) > 0;
  });
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
  title: string | null;
  author: string | null;
  tags: string[];
  views: string | null;
  likes: string | null;
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function listLinks(): Promise<LinkRow[]> {
  return enqueue(db => {
    const res = db.exec(
      `SELECT id, gif_id, url, image_url, page_url, created_at, title, author, tags, views, likes
       FROM links ORDER BY id`,
    );
    return (res[0]?.values ?? []).map(r => ({
      id: Number(r[0]),
      gifId: String(r[1]),
      url: String(r[2]),
      imageUrl: r[3] === null ? null : String(r[3]),
      pageUrl: r[4] === null ? null : String(r[4]),
      createdAt: String(r[5]),
      title: r[6] === null ? null : String(r[6]),
      author: r[7] === null ? null : String(r[7]),
      tags: parseTags(r[8]),
      views: r[9] === null ? null : String(r[9]),
      likes: r[10] === null ? null : String(r[10]),
    }));
  });
}