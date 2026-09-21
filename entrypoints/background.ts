import { buildHtml, buildXlsx } from '../utils/exporters';
import { bytesToBase64, exportDbBase64, getTotal, listLinks, saveLink } from '../utils/links-db';
import type { RgRequest, RgResponse } from '../utils/messages';

const ID_RE = /^[\w-]+$/;

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
    case 'RG_DOWNLOAD': {
      if (!ID_RE.test(msg.id) || !isRedgifsUrl(msg.url)) throw new Error('Datos inválidos');
      // Se descarga desde el background: sigue aunque cierres la pestaña
      const downloadId = await browser.downloads.download({
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
      });
      return { ok: true, inserted, total };
    }
    case 'RG_STATS':
      return { ok: true, total: await getTotal() };
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