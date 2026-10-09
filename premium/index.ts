// Implementación PREMIUM. Esta carpeta es la que se mueve a un repositorio privado
// (submódulo de git en `premium/`). Solo la importan las ediciones `premium` y `activated`.
import { bytesToBase64, exportDbBase64, getTotal, listLinks, saveLink } from '../utils/links-db';
import type { PremiumApi } from '../utils/premium-api';
import { buildHtml, buildXlsx } from './exporters';

export const premium: PremiumApi = {
  async exportLinks(format, language) {
    switch (format) {
      case 'sqlite':
        return { base64: await exportDbBase64(), filename: 'redgifs-links.sqlite', mime: 'application/vnd.sqlite3' };
      case 'db':
        return { base64: await exportDbBase64(), filename: 'redgifs-links.db', mime: 'application/octet-stream' };
      case 'xlsx':
        return {
          base64: bytesToBase64(buildXlsx(await listLinks(), language)),
          filename: 'redgifs-links.xlsx',
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
      case 'html': {
        const html = await buildHtml(await listLinks(), language);
        return { base64: bytesToBase64(new TextEncoder().encode(html)), filename: 'redgifs-links.html', mime: 'text/html;charset=utf-8' };
      }
      default:
        throw new Error('Formato desconocido');
    }
  },

  // Guarda varios links de una (selección múltiple en una grilla). saveLink() serializa los writes.
  async saveBulk(links, deps) {
    let inserted = 0;
    let updated = 0;
    for (const link of links) {
      if (!deps.idPattern.test(link.id) || !deps.isRedgifsUrl(link.url)) continue;
      if (link.imageUrl && !deps.isRedgifsUrl(link.imageUrl)) continue;
      const result = await saveLink({
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
      if (result.inserted) inserted++;
      else updated++;
    }
    return { inserted, updated, total: await getTotal() };
  },

  // Descarga en batch todo lo guardado. Las URLs vienen firmadas por RedGifs y pueden vencer.
  async downloadAll(deps) {
    const links = await listLinks();
    let queued = 0;
    let failed = 0;
    let withoutMetadata = 0;
    for (const link of links) {
      if (!deps.isRedgifsUrl(link.url)) {
        failed++;
        continue;
      }
      try {
        const result = await deps.startVideoDownload(link.gifId, link.url, {
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
    return { queued, failed, withoutMetadata };
  },
};
