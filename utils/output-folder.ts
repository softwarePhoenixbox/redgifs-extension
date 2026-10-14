// Destino de las descargas.
//
//  - modo `browser`: la carpeta de descargas que ya tiene configurada el navegador.
//    Una extensión no puede escribir fuera de ella con downloads.download, pero SÍ puede crear
//    subcarpetas dentro (Chrome y Firefox las crean si no existen).
//  - modo `custom`: una carpeta cualquiera del equipo (Documentos, otro disco como E:\…), elegida con el
//    selector del navegador (File System Access API, solo Chromium). Se guarda el "handle" en IndexedDB y
//    el archivo se escribe directo ahí. Si el permiso caducó o la carpeta ya no existe, la descarga cae a
//    la carpeta del navegador y se avisa (ver background.ts).
//
// En ambos modos, `subfolder` es opcional: se crea dentro del destino si no existe (también si se borró).

export type OutputMode = 'browser' | 'custom';

export interface OutputSettings {
  mode: OutputMode;
  /** Subcarpeta relativa ('' = directo en el destino). Puede tener varios niveles: "a/b". */
  subfolder: string;
  /** Nombre visible de la carpeta elegida en modo custom. */
  customName: string | null;
}

export const OUTPUT_MODE_KEY = 'rgOutputMode';
export const OUTPUT_SUBFOLDER_KEY = 'rgOutputSubfolder';
export const OUTPUT_CUSTOM_NAME_KEY = 'rgOutputCustomName';
/** La página de carpeta lo actualiza al autorizar, para que el popup se refresque aunque siga abierto. */
export const OUTPUT_AUTHORIZED_AT_KEY = 'rgOutputAuthorizedAt';
export const OUTPUT_STORAGE_KEYS = [OUTPUT_MODE_KEY, OUTPUT_SUBFOLDER_KEY, OUTPUT_CUSTOM_NAME_KEY];

/** Igual que antes de existir este ajuste: Descargas/redgifs. */
export const DEFAULT_SUBFOLDER = 'redgifs';

const MAX_SEGMENTS = 4;
const MAX_SEGMENT_LENGTH = 60;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Limpia lo que escribió el usuario: quita caracteres inválidos en Windows, "..", vacíos y nombres reservados. */
export function sanitizeSubfolder(value: unknown): string {
  if (typeof value !== 'string') return '';
  const segments: string[] = [];
  for (const raw of value.split(/[\\/]+/)) {
    // eslint-disable-next-line no-control-regex
    let segment = raw.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim().replace(/[. ]+$/, '');
    if (!segment || segment === '.' || segment === '..' || /^\.+$/.test(segment)) continue;
    if (RESERVED_WINDOWS_NAMES.test(segment)) segment = `_${segment}`;
    segments.push(segment.slice(0, MAX_SEGMENT_LENGTH).replace(/[. ]+$/, ''));
    if (segments.length >= MAX_SEGMENTS) break;
  }
  return segments.filter(Boolean).join('/');
}

export function normalizeOutputSettings(values: Record<string, unknown>): OutputSettings {
  const stored = values[OUTPUT_SUBFOLDER_KEY];
  return {
    mode: values[OUTPUT_MODE_KEY] === 'custom' ? 'custom' : 'browser',
    // Sin valor guardado → 'redgifs' (comportamiento anterior). Cadena vacía guardada → sin subcarpeta.
    subfolder: typeof stored === 'string' ? sanitizeSubfolder(stored) : DEFAULT_SUBFOLDER,
    customName: typeof values[OUTPUT_CUSTOM_NAME_KEY] === 'string' ? (values[OUTPUT_CUSTOM_NAME_KEY] as string) : null,
  };
}

export async function readOutputSettings(): Promise<OutputSettings> {
  try {
    return normalizeOutputSettings(await browser.storage.local.get(OUTPUT_STORAGE_KEYS));
  } catch {
    return normalizeOutputSettings({});
  }
}

/** Reemplaza la carpeta que traiga `filename` (p. ej. "redgifs/x.mp4") por `subfolder`. */
export function applySubfolder(filename: string, subfolder: string): string {
  const base = filename.split('/').pop() ?? filename;
  const folder = sanitizeSubfolder(subfolder);
  return folder ? `${folder}/${base}` : base;
}

// ---------- Carpeta personalizada (File System Access API) ----------

type PermissionMode = { mode: 'readwrite' };
type PermissionState = 'granted' | 'denied' | 'prompt';
type HandleWithPermissions = FileSystemDirectoryHandle & {
  queryPermission(descriptor: PermissionMode): Promise<PermissionState>;
  requestPermission(descriptor: PermissionMode): Promise<PermissionState>;
};

export function supportsFolderPicker(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

const DB_NAME = 'rg-output';
const STORE = 'handles';
const HANDLE_KEY = 'dir';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  try {
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(HANDLE_KEY);
      request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function clearDirectoryHandle(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** `request` solo funciona dentro de un clic del usuario (popup o página de selección). */
export async function directoryPermission(handle: FileSystemDirectoryHandle, request = false): Promise<PermissionState> {
  const h = handle as HandleWithPermissions;
  const current = await h.queryPermission({ mode: 'readwrite' });
  if (current === 'granted' || !request) return current;
  return h.requestPermission({ mode: 'readwrite' });
}

async function fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (error) {
    if ((error as DOMException)?.name === 'NotFoundError') return false;
    throw error;
  }
}

/** "video.mp4" → "video (1).mp4" si ya existe, como hace el navegador con `uniquify`. */
async function uniqueName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  if (!(await fileExists(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!(await fileExists(dir, candidate))) return candidate;
  }
  throw new Error('No se encontró un nombre libre en la carpeta');
}

export class OutputFolderError extends Error {
  constructor(message: string, readonly code: 'not_configured' | 'permission' | 'missing' | 'write') {
    super(message);
  }
}

/**
 * Escribe `bytes` en <carpeta elegida>/<subfolder>/<name>, creando la subcarpeta si falta.
 * Devuelve el nombre final (puede llevar " (1)" si ya existía).
 */
export async function writeToChosenFolder(subfolder: string, name: string, bytes: Uint8Array): Promise<string> {
  const root = await getReadyRoot();
  try {
    let dir = root;
    for (const segment of sanitizeSubfolder(subfolder).split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(segment, { create: true });
    }
    const finalName = await uniqueName(dir, name);
    const file = await dir.getFileHandle(finalName, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(bytes as unknown as BufferSource);
    } finally {
      await writable.close();
    }
    return finalName;
  } catch (error) {
    throw toFolderError(error);
  }
}

function toFolderError(error: unknown): OutputFolderError {
  if (error instanceof OutputFolderError) return error;
  const err = error as DOMException;
  if (err?.name === 'NotFoundError') return new OutputFolderError('La carpeta elegida ya no existe; elígela de nuevo', 'missing');
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return new OutputFolderError('Falta autorizar la carpeta elegida', 'permission');
  return new OutputFolderError(error instanceof Error ? error.message : String(error), 'write');
}

/** Comprueba (barato, antes de bajar nada) que hay carpeta elegida y permiso para escribir en ella. */
export async function getReadyRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await loadDirectoryHandle();
  if (!root) throw new OutputFolderError('Todavía no elegiste una carpeta', 'not_configured');
  let permission: PermissionState;
  try {
    permission = await directoryPermission(root);
  } catch {
    throw new OutputFolderError('La carpeta elegida ya no está disponible', 'missing');
  }
  if (permission !== 'granted') {
    throw new OutputFolderError('Chrome pidió autorizar de nuevo la carpeta: abre el popup de la extensión, Ajustes, y pulsa Autorizar', 'permission');
  }
  return root;
}

/**
 * Prueba real de escritura: crea y borra un archivo temporal en la carpeta elegida.
 * Es lo que significa "Ready" en el popup: no solo que el permiso figura como concedido,
 * sino que el documento que escribe las descargas (offscreen) puede escribir de verdad.
 */
export async function checkChosenFolderWritable(): Promise<void> {
  const root = await getReadyRoot();
  const name = `.redgifs-write-test-${Date.now()}`;
  try {
    const file = await root.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(new Uint8Array([0]) as unknown as BufferSource);
    await writable.close();
    await root.removeEntry(name);
  } catch (error) {
    throw toFolderError(error);
  }
}
