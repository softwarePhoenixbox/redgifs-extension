import { buildHtml, buildXlsx } from '../utils/exporters';
import { embedMp4Metadata } from '../utils/mp4-metadata';
import {
  bytesToBase64,
  deleteLink,
  exportDbBase64,
  getTotal,
  importDb,
  linkExists,
  listLinks,
  saveLink,
} from '../utils/links-db';
import type { RgRequest, RgResponse } from '../utils/messages';

const ID_RE = /^[\w-]+$/;
const REDGIFS_API = 'https://api.redgifs.com/v2';
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_BASE_DELAY_MS = 500;
interface ChromeOffscreenApi {
  createDocument(options: { url: string; reasons: ['BLOBS']; justification: string }): Promise<void>;
  hasDocument?: () => Promise<boolean>;
}
const blobUrlsByDownloadId = new Map<number, { url: string; offscreen: boolean }>();
const pendingAnchorBlobUrls = new Set<string>();
let creatingOffscreenDocument: Promise<void> | null = null;

function chromeOffscreenApi(): ChromeOffscreenApi | undefined {
  return (globalThis as typeof globalThis & { chrome?: { offscreen?: ChromeOffscreenApi } }).chrome?.offscreen;
}

async function hasChromeOffscreenDocument(api: ChromeOffscreenApi): Promise<boolean> {
  if (api.hasDocument) return api.hasDocument();
  const serviceWorkerClients = (globalThis as typeof globalThis & {
    clients?: { matchAll(): Promise<Array<{ url: string }>> };
  }).clients;
  if (!serviceWorkerClients) return false;
  const clients = await serviceWorkerClients.matchAll();
  const offscreenUrl = browser.runtime.getURL('/offscreen.html');
  return clients.some(client => client.url === offscreenUrl);
}

async function ensureChromeOffscreenDocument(api: ChromeOffscreenApi): Promise<void> {
  if (await hasChromeOffscreenDocument(api)) return;
  creatingOffscreenDocument ??= api.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Preparar un MP4 con sus metadatos y crear una URL Blob para descargarlo.',
  }).catch(async error => {
    if (!(await hasChromeOffscreenDocument(api))) throw error;
  }).finally(() => {
    creatingOffscreenDocument = null;
  });
  await creatingOffscreenDocument;
}

function releaseBlobUrl(blob: { url: string; offscreen: boolean }): void {
  if (blob.offscreen) {
    void browser.runtime.sendMessage({ type: 'RG_OFFSCREEN_REVOKE_BLOB', blob_url: blob.url });
  } else {
    URL.revokeObjectURL(blob.url);
  }
}

function triggerAnchorDownload(blobUrl: string, filename: string): boolean {
  if (typeof document === 'undefined') return false;
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename.split('/').pop() ?? filename;
  anchor.style.display = 'none';
  (document.body ?? document.documentElement).appendChild(anchor);
  pendingAnchorBlobUrls.add(blobUrl);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    if (!pendingAnchorBlobUrls.delete(blobUrl)) return;
    URL.revokeObjectURL(blobUrl);
  }, 15 * 60 * 1000);
  return true;
}

try {
  browser.downloads.onCreated.addListener(item => {
    if (!pendingAnchorBlobUrls.delete(item.url)) return;
    blobUrlsByDownloadId.set(item.id, { url: item.url, offscreen: false });
  });
} catch {
  // WXT's build-time fake browser does not implement downloads.onCreated.
}

try {
  browser.downloads.onChanged.addListener(delta => {
    if (delta.state?.current !== 'complete' && delta.state?.current !== 'interrupted') return;
    const blob = blobUrlsByDownloadId.get(delta.id);
    if (!blob) return;
    releaseBlobUrl(blob);
    blobUrlsByDownloadId.delete(delta.id);
  });
} catch {
  // WXT's build-time fake browser does not implement downloads.onChanged.
}

interface RedgifsAuthResponse { token?: string }
interface RedgifsGifResponse {
  gif?: {
    urls?: { hd?: string; sd?: string; thumbnail?: string; poster?: string };
    description?: string;
    title?: string;
    userName?: string;
    tags?: string[];
  };
}

let redgifsToken = '';

async function refreshRedgifsToken(): Promise<string> {
  const response = await fetch(`${REDGIFS_API}/auth/temporary`);
  if (!response.ok) throw new Error(`RedGifs auth respondió ${response.status}`);
  const data = (await response.json()) as RedgifsAuthResponse;
  if (!data.token) throw new Error('RedGifs no devolvió token de acceso');
  redgifsToken = data.token;
  return redgifsToken;
}

async function resolveRedgifsGif(id: string, retry = true): Promise<RgResponse> {
  try {
    if (!redgifsToken) await refreshRedgifsToken();
    let response = await fetch(`${REDGIFS_API}/gifs/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${redgifsToken}` },
    });
    if (response.status === 401 && retry) {
      redgifsToken = await refreshRedgifsToken();
      response = await fetch(`${REDGIFS_API}/gifs/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${redgifsToken}` },
      });
    }
    if (response.status === 404) return { ok: true, not_found: true };
    if (response.status === 429) return { ok: true, rate_limited: true };
    if (!response.ok) return { ok: false, error: `Error ${response.status} al consultar la API de RedGifs` };

    const data = (await response.json()) as RedgifsGifResponse;
    const urls = data.gif?.urls;
    const videoUrl = urls?.hd ?? urls?.sd;
    if (!videoUrl || !isRedgifsUrl(videoUrl)) return { ok: true, not_found: true };
    const imageUrl = urls?.thumbnail ?? urls?.poster ?? videoUrl.replace(/\.[a-z0-9]+$/i, '-mobile.jpg');
    const source = data.gif;
    const description = source?.description?.trim() ?? '';
    const title = source?.title?.trim() || description.split(/\r?\n/).map(line => line.trim()).filter(Boolean).find(line => !/^#[\p{L}\p{N}_\s]+$/u.test(line)) || '';
    const tags = Array.isArray(source?.tags)
      ? source.tags.map(tag => tag.trim()).filter(Boolean).map(tag => tag.startsWith('#') ? tag : `#${tag}`)
      : [];
    return {
      ok: true,
      gif: {
        videoUrl,
        imageUrl: isRedgifsUrl(imageUrl) ? imageUrl : videoUrl,
        metadata: {
          title: title || null,
          author: source?.userName?.trim() || null,
          tags,
        },
      },
    };
  } catch (error) {
    console.error('[RG Scroller] Error al consultar la API de RedGifs', error);
    return { ok: false, error: 'No se pudo conectar con la API de RedGifs. Revisa tu conexión o VPN.' };
  }
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Reintenta la descarga con backoff exponencial (500ms, 1s, 2s...) antes de
// darse por vencido. Cubre fallos transitorios (permiso pedido recién ahora,
// hiccup de disco); si el motivo es permanente (ej. sin espacio) el último
// intento igual falla y se lo devolvemos al usuario con el mensaje real.
async function downloadWithRetry(
  options: Parameters<typeof browser.downloads.download>[0],
  attempts = DOWNLOAD_ATTEMPTS,
): Promise<number> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await browser.downloads.download(options);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(DOWNLOAD_BASE_DELAY_MS * 2 ** i);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Solo aceptamos links https de redgifs.com
function isRedgifsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (u.hostname === 'redgifs.com' || u.hostname.endsWith('.redgifs.com'));
  } catch {
    return false;
  }
}

function extensionOf(url: string): string {
  const match = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
  return match?.[1]?.toLowerCase() ?? 'mp4';
}

async function startVideoDownload(
  id: string,
  url: string,
  metadata: { title?: string | null; author?: string | null; tags?: string[]; pageUrl?: string | null },
): Promise<{ downloadId?: number; metadataEmbedded: boolean; metadataWarning?: string }> {
  const filename = `redgifs/${id}.${extensionOf(url)}`;
  const hasMetadata = Boolean(metadata.title || metadata.author || metadata.tags?.length || metadata.pageUrl);
  if (!hasMetadata) {
    return {
      downloadId: await downloadWithRetry({ url, filename, conflictAction: 'uniquify', saveAs: false }),
      metadataEmbedded: false,
      metadataWarning: 'No se detectaron metadatos; el video se descargó sin metadatos.',
    };
  }
  if (!['mp4', 'm4v'].includes(extensionOf(url))) {
    return {
      downloadId: await downloadWithRetry({ url, filename, conflictAction: 'uniquify', saveAs: false }),
      metadataEmbedded: false,
      metadataWarning: `El formato ${extensionOf(url)} no admite esta incrustación; se descargó sin metadatos.`,
    };
  }

  let blobUrl: string | undefined;
  let blobCreatedOffscreen = false;
  try {
    const offscreenApi = chromeOffscreenApi();
    if (offscreenApi) {
      await ensureChromeOffscreenDocument(offscreenApi);
      const prepared = await browser.runtime.sendMessage({
        type: 'RG_OFFSCREEN_PREPARE_BLOB',
        url,
        metadata,
      });
      if (!prepared?.ok || !prepared.blob_url) {
        throw new Error(prepared?.error ?? 'No se pudo preparar el MP4 en Chrome');
      }
      blobUrl = prepared.blob_url;
      blobCreatedOffscreen = true;
    } else {
      if (typeof URL.createObjectURL !== 'function') throw new Error('Este navegador no permite preparar archivos MP4');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`respuesta HTTP ${response.status}`);
      const source = new Uint8Array(await response.arrayBuffer());
      const tagged = embedMp4Metadata(source, metadata);
      const taggedBuffer = new ArrayBuffer(tagged.byteLength);
      new Uint8Array(taggedBuffer).set(tagged);
      blobUrl = URL.createObjectURL(new Blob([taggedBuffer], { type: 'video/mp4' }));
    }
    if (!blobUrl) throw new Error('No se pudo crear el archivo MP4 temporal');
    const preparedBlobUrl = blobUrl;
    // Firefox's downloads API may reject Blob URLs from extensions. Its
    // background-page anchor path can download the same tagged bytes directly.
    if (!blobCreatedOffscreen && triggerAnchorDownload(preparedBlobUrl, filename)) {
      return { metadataEmbedded: true };
    }
    let downloadId: number;
    try {
      downloadId = await downloadWithRetry({
        url: preparedBlobUrl,
        filename,
        conflictAction: 'uniquify',
        saveAs: false,
      });
    } catch (downloadError) {
      // Firefox may reject a Blob URL in downloads.download even when the
      // Blob was created by the extension background page. Use its native
      // anchor download path before falling back to the unmodified MP4.
      throw downloadError;
    }
    blobUrlsByDownloadId.set(downloadId, { url: preparedBlobUrl, offscreen: blobCreatedOffscreen });
    // Cubre el caso de archivos pequeños que completan antes de registrar el ID.
    try {
      const [item] = await browser.downloads.search({ id: downloadId });
      if (item?.state === 'complete' || item?.state === 'interrupted') {
        releaseBlobUrl({ url: preparedBlobUrl, offscreen: blobCreatedOffscreen });
        blobUrlsByDownloadId.delete(downloadId);
      }
    } catch {
      // onChanged libera el blob URL cuando finalice la descarga.
    }
    return { downloadId, metadataEmbedded: true };
  } catch (error) {
    if (blobUrl) releaseBlobUrl({ url: blobUrl, offscreen: blobCreatedOffscreen });
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[RG Scroller] Descarga sin metadatos para ${id}:`, reason);
    // Si el parche de metadatos falla, no bloqueamos la descarga del video original.
    const downloadId = await downloadWithRetry({ url, filename, conflictAction: 'uniquify', saveAs: false });
    return {
      downloadId,
      metadataEmbedded: false,
      metadataWarning: `No se pudieron incrustar los metadatos (${reason}); se descargó el video sin metadatos.`,
    };
  }
}

async function handle(msg: RgRequest): Promise<RgResponse> {
  switch (msg.type) {
    case 'RG_RESOLVE_GIF': {
      if (!ID_RE.test(msg.id)) throw new Error('ID de RedGifs inválido');
      return resolveRedgifsGif(msg.id);
    }
    case 'RG_DOWNLOAD': {
      if (!ID_RE.test(msg.id) || !isRedgifsUrl(msg.url)) throw new Error('Datos inválidos');
      // Descarga en el background y añade metadatos Xtra/QuickTime sin recodificar.
      const result = await startVideoDownload(msg.id, msg.url, msg);
      return {
        ok: true,
        downloadId: result.downloadId,
        metadata_embedded: result.metadataEmbedded,
        metadata_warning: result.metadataWarning,
      };
    }
    case 'RG_SAVE_LINK': {
      if (!ID_RE.test(msg.id) || !isRedgifsUrl(msg.url)) throw new Error('Datos inválidos');
      if (msg.imageUrl && !isRedgifsUrl(msg.imageUrl)) throw new Error('Datos inválidos');
      const { inserted, total } = await saveLink({
        gifId: msg.id,
        url: msg.url,
        imageUrl: msg.imageUrl,
        pageUrl: msg.pageUrl,
        // Metadatos scrapeados en el content script (título, autor, tags, vistas, likes)
        title: msg.title,
        author: msg.author,
        tags: msg.tags,
        views: msg.views,
        likes: msg.likes,
      });
      return { ok: true, inserted, total };
    }
    case 'RG_SAVE_BULK': {
      // Guarda varios links de una (selección múltiple en una grilla de
      // tags/usuario). Reutiliza saveLink() uno por uno -> la cola interna
      // de links-db.ts ya serializa los writes, así que esto es seguro
      // aunque se dispare junto con otros guardados.
      let insertedCount = 0;
      let updatedCount = 0;
      for (const link of msg.links) {
        if (!ID_RE.test(link.id) || !isRedgifsUrl(link.url)) continue;
        if (link.imageUrl && !isRedgifsUrl(link.imageUrl)) continue;
        const { inserted } = await saveLink({
          gifId: link.id,
          url: link.url,
          imageUrl: link.imageUrl,
          pageUrl: link.pageUrl,
          title: link.title,
          author: link.author,
          tags: link.tags,
          views: link.views,
          likes: link.likes,
        });
        if (inserted) insertedCount++;
        else updatedCount++;
      }
      return { ok: true, inserted_count: insertedCount, updated_count: updatedCount, total: await getTotal() };
    }
    case 'RG_STATS':
      return { ok: true, total: await getTotal() };
    case 'RG_CHECK_LINK':
      return { ok: true, exists: await linkExists(msg.id) };
    case 'RG_LIST_LINKS':
      return { ok: true, links: await listLinks() };
    case 'RG_DELETE_LINK':
      return { ok: true, total: await deleteLink(msg.id) };
    case 'RG_DOWNLOAD_ALL': {
      // Descarga en batch todo lo guardado. Ojo: las URLs vienen firmadas
      // por la API de RedGifs y pueden vencer con el tiempo, así que un
      // link viejo puede fallar acá aunque haya sido válido al guardarlo.
      const links = await listLinks();
      let queued = 0;
      let failed = 0;
      let withoutMetadata = 0;
      for (const link of links) {
        if (!isRedgifsUrl(link.url)) {
          failed++;
          continue;
        }
        try {
          const result = await startVideoDownload(link.gifId, link.url, {
            title: link.title,
            author: link.author,
            tags: link.tags,
            pageUrl: link.pageUrl,
          });
          queued++;
          if (!result.metadataEmbedded) withoutMetadata++;
        } catch {
          failed++;
        }
      }
      return { ok: true, queued, failed, without_metadata: withoutMetadata };
    }
    case 'RG_IMPORT_DB': {
      const { imported, updated, total } = await importDb(base64ToBytes(msg.base64));
      return { ok: true, imported, updated, total };
    }
    case 'RG_EXPORT_DB':
      switch (msg.format) {
        case 'sqlite':
          return { ok: true, base64: await exportDbBase64(), filename: 'redgifs-links.sqlite', mime: 'application/vnd.sqlite3' };
        case 'db':
          return { ok: true, base64: await exportDbBase64(), filename: 'redgifs-links.db', mime: 'application/octet-stream' };
        case 'xlsx':
          return {
            ok: true,
            base64: bytesToBase64(buildXlsx(await listLinks())),
            filename: 'redgifs-links.xlsx',
            mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          };
        case 'html': {
          const html = await buildHtml(await listLinks());
          return {
            ok: true,
            base64: bytesToBase64(new TextEncoder().encode(html)),
            filename: 'redgifs-links.html',
            mime: 'text/html;charset=utf-8',
          };
        }
        default:
          throw new Error('Formato desconocido');
      }
    default:
      throw new Error('Mensaje desconocido');
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: RgRequest, sender, sendResponse) => {
    // runtime.onMessage solo recibe mensajes de esta extensión; no filtramos
    // sender.id porque Chrome puede omitirlo en algunos mensajes de content script.
    console.debug(`[RG Scroller] Background recibió ${message.type}`, {
      senderId: sender.id ?? '(vacío)',
      runtimeId: browser.runtime.id,
    });
    handle(message)
      .then(response => {
        console.debug(`[RG Scroller] Background respondió ${message.type}: ${response.ok ? 'ok' : 'error'}`);
        sendResponse(response);
      })
      .catch((err: unknown) => {
        console.error(`[RG Scroller] Background falló en ${message.type}`, err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies RgResponse);
      });
    // Patrón compatible con Chrome anterior a la respuesta Promise de MV3 y Firefox.
    return true;
  });
});
