import { buildHtml, buildXlsx } from '../utils/exporters';
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

interface RedgifsAuthResponse { token?: string }
interface RedgifsGifResponse {
  gif?: { urls?: { hd?: string; sd?: string; thumbnail?: string; poster?: string } };
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
    return {
      ok: true,
      gif: { videoUrl, imageUrl: isRedgifsUrl(imageUrl) ? imageUrl : videoUrl },
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

async function handle(msg: RgRequest): Promise<RgResponse> {
  switch (msg.type) {
    case 'RG_RESOLVE_GIF': {
      if (!ID_RE.test(msg.id)) throw new Error('ID de RedGifs inválido');
      return resolveRedgifsGif(msg.id);
    }
    case 'RG_DOWNLOAD': {
      if (!ID_RE.test(msg.id) || !isRedgifsUrl(msg.url)) throw new Error('Datos inválidos');
      // Se descarga desde el background: sigue aunque cierres la pestaña
      const downloadId = await downloadWithRetry({
        url: msg.url,
        filename: `redgifs/${msg.id}.${extensionOf(msg.url)}`,
        conflictAction: 'uniquify',
        saveAs: false,
      });
      return { ok: true, downloadId };
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
      for (const link of links) {
        if (!isRedgifsUrl(link.url)) {
          failed++;
          continue;
        }
        try {
          await downloadWithRetry({
            url: link.url,
            filename: `redgifs/${link.gifId}.${extensionOf(link.url)}`,
            conflictAction: 'uniquify',
            saveAs: false,
          });
          queued++;
        } catch {
          failed++;
        }
      }
      return { ok: true, queued, failed };
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
    // Solo mensajes de esta misma extensión
    if (sender.id !== browser.runtime.id) return;

    handle(message)
      .then(sendResponse)
      .catch((err: unknown) => {
        console.error('[RG Scroller] background', err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true; // respuesta asíncrona
  });
});
