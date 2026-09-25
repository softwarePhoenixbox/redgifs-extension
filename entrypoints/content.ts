import type { ExportFormat, RgRequest, RgResponse } from '../utils/messages';
import { popupMessage, type PopupLanguage } from '../utils/popup-i18n';
import { DEFAULT_DOWNLOAD_OPTIONS, enabledDownloadChoices, normalizeDownloadOptions, type DownloadChoice, type DownloadOptions } from '../utils/download-options';

export default defineContentScript({
  matches: ['*://*.redgifs.com/*'],
  allFrames: true,

  main(ctx) {
    // ---------- Constantes ----------
    const PANEL_ID = 'rg-scroller-panel';
    const STYLE_ID = 'rg-scroller-style';
    // Selector "feliz" del feed de scroll infinito. Si RedGifs cambia el
    // markup y esto deja de matchear, getActiveItem() igual sigue andando
    // en /watch/<id> (lee el id de la URL) y en perfiles/grillas (usa el
    // item con data-feed-item-id más cercano al centro de la pantalla).
    const ACTIVE_ITEM_SELECTOR = '.GifPreview.GifPreview_isActive[data-feed-item-id]';
    const WATCH_PATH_RE = /\/(?:watch|ifr)\/([\w-]+)/;
    const AUTO_SAVE_KEY = 'rgAutoSave';
    const AUTO_SAVE_MIN_VIEWS_KEY = 'rgAutoSaveMinViews';
    const PANEL_POSITION_KEY = 'rgPanelPosition';
    const PANEL_COLLAPSED_KEY = 'rgPanelCollapsed';
    const PANEL_ENABLED_KEY = 'rgPanelEnabled';
    const DOWNLOAD_ACTION_ENABLED_KEY = 'rgDownloadActionEnabled';
    const DOWNLOAD_QUALITY_KEY = 'rgDownloadQuality';
    const DOWNLOAD_OPTIONS_KEY = 'rgDownloadOptions';
    const ORIGINAL_FILENAME_KEY = 'rgOriginalFilename';
    const LANGUAGE_KEY = 'rgLanguage';
    let language: PopupLanguage = 'en';
    const t = (key: Parameters<typeof popupMessage>[1], values?: Record<string, string | number>) => popupMessage(language, key, values);
    let scrollDirection: 'down' | 'up' = 'down';
    const previousScrollOffsets = new WeakMap<object, number>();

    // Las 4 esquinas entre las que se puede mover el panel con el botón ⇄.
    const PANEL_POSITIONS: Array<{ top?: string; bottom?: string; left?: string; right?: string }> = [
      { top: '20px', left: '20px' },
      { top: '20px', right: '20px' },
      { bottom: '20px', right: '20px' },
      { bottom: '20px', left: '20px' },
    ];

    const BLUE = '#2f6bff';
    const RED = '#e5484d';
    const GREEN = '#00ff00';

    // ---------- Utilidades DOM ----------
    function createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      css: string,
      text?: string,
    ): HTMLElementTagNameMap[K] {
      const el = document.createElement(tag);
      el.style.cssText = css;
      if (text !== undefined) el.textContent = text;
      return el;
    }

    function buttonCss(bg: string, color: string): string {
      return `background:${bg}; color:${color}; border:none; cursor:pointer; text-align:center; text-decoration:none; padding:10px; border-radius:6px; font-weight:bold; font-size:12px; display:block; width:100%; box-sizing:border-box; font-family:inherit;`;
    }

    function setStatus(el: HTMLElement, text: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
      el.textContent = text;
      el.style.color = kind === 'ok' ? '#7ee787' : kind === 'error' ? '#ff8b8b' : '#aaa';
    }

    // Toast flotante para confirmaciones importantes (guardado, duplicado),
    // más visible que el texto chico de dbStatus.
    function showToast(message: string, kind: 'ok' | 'error' = 'ok'): void {
      const toast = createEl(
        'div',
        `position:fixed; bottom:20px; right:20px; z-index:10001; background:${
          kind === 'ok' ? '#173c2b' : '#3c1717'
        }; color:${kind === 'ok' ? '#7ee787' : '#ff8b8b'}; border:1px solid ${
          kind === 'ok' ? '#2ea043' : '#e5484d'
        }; padding:10px 14px; border-radius:8px; font-family:sans-serif; font-size:12px; box-shadow:0 6px 20px rgba(0,0,0,0.5); animation:zoomIn 0.2s; max-width:280px;`,
        message,
      );
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2500);
    }

    // Convierte "77K" / "1.2M" / "930" en un número, para comparar contra el
    // umbral de auto-guardado.
    function parseViewsCount(raw: string | null): number {
      if (!raw) return 0;
      const match = /^([\d.]+)\s*([KM]?)/i.exec(raw.trim());
      if (!match) {
        const digits = raw.replace(/[^\d]/g, '');
        return digits ? Number(digits) : 0;
      }
      const num = Number(match[1]);
      const unit = match[2]?.toUpperCase();
      const mult = unit === 'K' ? 1_000 : unit === 'M' ? 1_000_000 : 1;
      return Math.round(num * mult);
    }

    // Convierte el base64 recibido en un archivo y lo descarga
    function saveBase64AsFile(base64: string, filename: string, mime: string): void {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    }

    // ---------- Scraping de metadatos (título, autor, tags, vistas, likes) ----------
    // Estructura vista en el DOM de RedGifs (puede cambiar; si deja de matchear
    // revisar con el inspector el bloque .userInfo / .description / .sideBar
    // del item activo):
    //   div.userInfo > a[href^="/users/"] > span.userName            -> "slimthickn"
    //   div.description > span.descriptionText
    //     "Título del video"
    //     "#tag1 #tag2 #tag3"
    //   li.sideBarItem > div.ViewButton > div.ViewButton-Label        -> "77K"
    //   li.sideBarItem > button.LikeButton > span.label               -> "359"
    interface ScrapedMeta {
      title: string | null;
      author: string | null;
      tags: string[];
      views: string | null;
      likes: string | null;
    }

    function scrapeMeta(activeItem: HTMLElement): ScrapedMeta {
      let title: string | null = null;
      let tags: string[] = [];

      const descEl = activeItem.querySelector<HTMLElement>('.description .descriptionText, .descriptionText');
      if (descEl) {
        // El título y los hashtags vienen como nodos de texto separados dentro
        // del mismo span; si en algún momento RedGifs los separa en <span>
        // hijos esto también los captura porque usamos childNodes completos.
        const parts = Array.from(descEl.childNodes)
          .map(n => n.textContent?.trim() ?? '')
          .filter(Boolean);

        const hashtagLineIdx = parts.findIndex(p => p.startsWith('#'));
        if (hashtagLineIdx === -1) {
          // No se detectaron hashtags como línea separada: se intenta extraer
          // del texto completo igualmente.
          const fullText = descEl.textContent ?? '';
          title = (parts[0] ?? fullText).trim() || null;
          tags = fullText.match(/#[\p{L}\p{N}_]+/gu) ?? [];
        } else {
          title = parts.slice(0, hashtagLineIdx).join(' ').trim() || null;
          const tagsText = parts.slice(hashtagLineIdx).join(' ');
          tags = tagsText.match(/#[\p{L}\p{N}_]+/gu) ?? [];
        }
      }

      // El nombre de usuario se lee del href del link al perfil
      // (/users/<nombre>), que es más estable que depender del span interno:
      // el <a> del avatar también contiene un <span> (el wrapper de la
      // imagen) que aparece antes que el span.userName real en el DOM, así
      // que un selector genérico "a[href^='/users/'] span" puede devolver
      // ese span vacío en vez del nombre.
      const profileHref =
        activeItem
          .querySelector<HTMLAnchorElement>(
            '.userInfo a[href^="/users/"], a[aria-label^="Link to "][href^="/users/"]',
          )
          ?.getAttribute('href') ?? null;
      const hrefMatch = profileHref ? /\/users\/([^/?#]+)/.exec(profileHref) : null;
      const authorFromHref = hrefMatch ? decodeURIComponent(hrefMatch[1] ?? '') || null : null;

      const authorFromSpan =
        activeItem.querySelector<HTMLElement>('.userInfo .userName, span.userName')?.textContent?.trim() ||
        null;

      const author = authorFromHref ?? authorFromSpan;

      const views =
        activeItem.querySelector<HTMLElement>('.ViewButton-Label, [class*="ViewButton"] [class*="Label"]')
          ?.textContent?.trim() || null;
      const likes =
        activeItem.querySelector<HTMLElement>('.LikeButton .label, [class*="LikeButton"] [class*="label"]')
          ?.textContent?.trim() || null;

      return { title, author, tags, views, likes };
    }

    // Eliminar panel y estilo anteriores si existen
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText =
  'position:fixed; top:20px; left:20px; z-index:10000; background:rgba(18,18,18,0.98); color:white; padding:15px; border-radius:12px; font-family:sans-serif; width:300px; border:1px solid #00ff00; box-shadow:0 10px 30px rgba(0,0,0,0.8); display:flex; flex-direction:column;';
    panel.innerHTML = `
      <div id="rg-header" style="font-weight:bold; border-bottom:1px solid #444; padding-bottom:10px; margin-bottom:10px; color:#00ff00; display:flex; align-items:center; gap:8px;">
        <span id="rg-panel-title">${t('panelTitle')}</span>
        <div style="margin-left:auto; display:flex; gap:6px;">
          <button id="rg-move-btn" title="${t('movePanel')}" style="background:transparent; border:none; color:#9fd3ff; font-size:13px; cursor:pointer; font-family:inherit; padding:0 2px;">⇄</button>
          <button id="rg-collapse-btn" title="${t('minimize')}" style="background:transparent; border:none; color:#00ff00; font-size:14px; font-weight:bold; cursor:pointer; font-family:inherit; padding:0 2px;">–</button>
        </div>
      </div>
      <div id="rg-content" style="font-size:12px; min-height:80px; display:flex; align-items:center; justify-content:center;">
        <p style="color:#888; text-align:center;">${t('detectPrompt')}</p>
      </div>
    `;
    document.body.appendChild(panel);

    const content = panel.querySelector<HTMLDivElement>('#rg-content')!;
    const moveBtn = panel.querySelector<HTMLButtonElement>('#rg-move-btn')!;
    const collapseBtn = panel.querySelector<HTMLButtonElement>('#rg-collapse-btn')!;

    function applyPanelPosition(idx: number): void {
      const pos = PANEL_POSITIONS[idx % PANEL_POSITIONS.length]!;
      panel.style.top = pos.top ?? 'auto';
      panel.style.bottom = pos.bottom ?? 'auto';
      panel.style.left = pos.left ?? 'auto';
      panel.style.right = pos.right ?? 'auto';
    }

    // Animación suave
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '@keyframes zoomIn { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }';
    document.head.appendChild(style);

    // ---------- Estado ----------
    let currentActiveId: string | null = null;
    let panelRetryCount = 0;
    let panelRetryId: string | null = null;
    let panelRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let autoSave = false;
    let autoSaveMinViews = 0;
    let panelPositionIdx = 0;
    let panelCollapsed = false;
    let panelEnabled = false;
    let downloadActionEnabled = true;
    let downloadOptions: DownloadOptions = DEFAULT_DOWNLOAD_OPTIONS;
    let originalFilenameEnabled = true;

    moveBtn.addEventListener('click', () => {
      panelPositionIdx = (panelPositionIdx + 1) % PANEL_POSITIONS.length;
      applyPanelPosition(panelPositionIdx);
      void browser.storage.local.set({ [PANEL_POSITION_KEY]: panelPositionIdx });
    });

    collapseBtn.addEventListener('click', () => {
      panelCollapsed = !panelCollapsed;
      content.style.display = panelCollapsed ? 'none' : 'flex';
      collapseBtn.textContent = panelCollapsed ? '+' : '–';
      void browser.storage.local.set({ [PANEL_COLLAPSED_KEY]: panelCollapsed });
    });

    // ---------- Comunicación con el background ----------
    async function send(request: RgRequest): Promise<RgResponse> {
      try {
        const res = (await browser.runtime.sendMessage(request)) as RgResponse | undefined;
        if (!res) console.warn(`[RG Scroller] Background no respondió a ${request.type}`);
        return res ?? { ok: false, error: `El background no respondió (${request.type})` };
      } catch {
        console.error(`[RG Scroller] Falló el envío del mensaje ${request.type}`);
        return { ok: false, error: 'No se pudo contactar con la extensión. Recarga la página.' };
      }
    }

    // ---------- API de RedGifs ----------
    type GifLinkResult =
      | { kind: 'ok'; videoUrl: string; hdVideoUrl?: string; sdVideoUrl?: string; imageUrl: string; metadata?: { title: string | null; author: string | null; tags: string[] } }
      | { kind: 'not_found' }
      | { kind: 'rate_limited' }
      | { kind: 'error'; message: string };

    type ResolvedGif = Extract<GifLinkResult, { kind: 'ok' }>;
    const resolvedGifCache = new Map<string, { result: ResolvedGif; expiresAt: number }>();
    const pendingGifResolutions = new Map<string, Promise<GifLinkResult>>();

    function getValidLink(id: string): Promise<GifLinkResult> {
      const cached = resolvedGifCache.get(id);
      if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.result);
      if (cached) resolvedGifCache.delete(id);
      const pending = pendingGifResolutions.get(id);
      if (pending) return pending;

      const request = (async (): Promise<GifLinkResult> => {
        const response = await send({ type: 'RG_RESOLVE_GIF', id });
        if (!response.ok) return { kind: 'error', message: response.error };
        if (response.not_found) return { kind: 'not_found' };
        if (response.rate_limited) return { kind: 'rate_limited' };
        if (!response.gif) return { kind: 'error', message: t('apiMissingUrl') };
        const resolved: ResolvedGif = { kind: 'ok', ...response.gif };
        // La URL de media puede expirar; reutilizamos la consulta compartida
        // unos minutos para evitar dobles llamadas al hacer scroll/clic.
        resolvedGifCache.set(id, { result: resolved, expiresAt: Date.now() + 5 * 60_000 });
        return resolved;
      })();
      pendingGifResolutions.set(id, request);
      void request.finally(() => {
        if (pendingGifResolutions.get(id) === request) pendingGifResolutions.delete(id);
      });
      return request;
    }

    function mobileVideoUrl(result: ResolvedGif): string {
      if (result.sdVideoUrl) return result.sdVideoUrl;
      const hd = result.hdVideoUrl ?? result.videoUrl;
      return hd.replace(/\.mp4(?=([?#]|$))/i, '-mobile.mp4');
    }

    function originalFilename(root: HTMLElement | null, choice: DownloadChoice): string | undefined {
      const findIn = (scope: ParentNode): string[] => {
        const pending: ParentNode[] = [scope];
        const visited = new Set<ParentNode>();
        const urls: string[] = [];
        while (pending.length) {
          const current = pending.shift()!;
          if (visited.has(current)) continue;
          visited.add(current);
          const elements = Array.from(current.querySelectorAll<HTMLElement>('*'));
          for (const element of elements) {
            if (element.shadowRoot) pending.push(element.shadowRoot);
            urls.push(element.getAttribute('data-poster') ?? '', element.getAttribute('data-src') ?? '');
            const inlineStyle = element.getAttribute('style') ?? '';
            urls.push(...Array.from(inlineStyle.matchAll(/url\(["']?(.*?)["']?\)/g), match => match[1] ?? ''));
          }
          // Prioritize the active media's poster/source instead of returning
          // the first thumbnail in DOM order (which can be an internal UUID).
          for (const video of Array.from(current.querySelectorAll<HTMLVideoElement>('video'))) {
            urls.push(video.getAttribute('poster') ?? '', video.poster, video.currentSrc, video.src);
          }
          for (const image of Array.from(current.querySelectorAll<HTMLImageElement>('img'))) {
            urls.push(image.currentSrc, image.getAttribute('src') ?? '', image.src);
          }
          for (const source of Array.from(current.querySelectorAll<HTMLSourceElement>('source'))) {
            urls.push(source.getAttribute('src') ?? '', source.src);
          }
          for (const anchor of Array.from(current.querySelectorAll<HTMLAnchorElement>('a[href*="media.redgifs.com/"]'))) {
            urls.push(anchor.href);
          }
        }
        for (const entry of performance.getEntriesByType('resource')) urls.push(entry.name);
        const ids: string[] = [];
        for (const rawUrl of urls) {
          if (!rawUrl) continue;
          let mediaUrl: URL;
          try { mediaUrl = new URL(rawUrl, location.href); } catch { continue; }
          if (mediaUrl.hostname !== 'redgifs.com' && !mediaUrl.hostname.endsWith('.redgifs.com')) continue;
          let basename = mediaUrl.pathname.split('/').filter(Boolean).at(-1) ?? '';
          try { basename = decodeURIComponent(basename); } catch { /* keep encoded name */ }
          const match = /^(.+?)(?:-mobile|-silent)?\.(?:jpg|jpeg|mp4|m4v)$/i.exec(basename);
          if (match?.[1]) ids.push(match[1]);
        }
        return ids;
      };

      const candidates = [...new Set([...(root ? findIn(root) : []), ...findIn(document)])];
      // Resource URLs sometimes expose a lowercased alias before the original
      // case-sensitive media filename. Prefer the canonical mixed-case ID.
      const isUuid = (candidate: string) => /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(candidate);
      const id = candidates.find(candidate => !isUuid(candidate) && /[A-Z]/.test(candidate) && /[a-z]/.test(candidate))
        ?? candidates.find(candidate => !isUuid(candidate))
        ?? candidates[0];
      if (!id) return undefined;
      const suffix = choice === 'hd' ? '' : choice === 'sd' ? '-sd' : choice === 'frame' ? '-frame' : choice === 'image' ? '-image' : '-mobile';
      const extension = choice === 'image' || choice === 'frame' ? 'jpg' : 'mp4';
      return `${id}${suffix}.${extension}`;
    }

    function requestedFilename(root: HTMLElement | null, choice: DownloadChoice): string | undefined {
      if (!originalFilenameEnabled) {
        console.info('[RG Scroller] Nombres originales de RedGifs desactivados', { choice, page: location.href });
        return undefined;
      }
      const filename = originalFilename(root, choice);
      const details = { choice, filename: filename ?? null, page: location.href };
      if (filename) console.info('[RG Scroller] Filename de RedGifs detectado', details);
      else console.warn('[RG Scroller] No se encontró filename canónico de RedGifs', details);
      return filename;
    }

    function showDownloadMenu(anchor: HTMLElement, choices: DownloadChoice[], onChoose: (choice: DownloadChoice) => void): void {
      document.getElementById('rg-quality-menu')?.remove();
      const rect = anchor.getBoundingClientRect();
      const menu = document.createElement('div');
      menu.id = 'rg-quality-menu';
      menu.style.cssText = `position:fixed;z-index:10010;top:${Math.min(rect.bottom + 5, window.innerHeight - 90)}px;left:${Math.max(8, Math.min(rect.left, window.innerWidth - 150))}px;display:flex;gap:5px;padding:6px;background:#181818;border:1px solid #555;border-radius:7px;box-shadow:0 5px 18px #0009;`;
      const dismiss = (event: Event) => {
        if (!menu.contains(event.target as Node) && event.target !== anchor) {
          menu.remove();
          document.removeEventListener('pointerdown', dismiss, true);
        }
      };
      for (const choice of choices) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = t(choice === 'hd' ? 'downloadHd' : choice === 'sd' ? 'downloadSd' : choice === 'image' ? 'downloadImage' : 'downloadFrame');
        button.style.cssText = 'border:0;border-radius:5px;padding:6px 12px;background:#2f6bff;color:#fff;font:bold 12px sans-serif;cursor:pointer;';
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          menu.remove();
          document.removeEventListener('pointerdown', dismiss, true);
          onChoose(choice);
        }, { once: true });
        menu.appendChild(button);
      }
      document.body.appendChild(menu);
      setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
    }

    function requestDownloadChoice(anchor: HTMLElement, action: (choice: DownloadChoice) => void): void {
      const choices = enabledDownloadChoices(downloadOptions);
      if (choices.length > 1) showDownloadMenu(anchor, choices, action);
      else if (choices.length === 1) action(choices[0]!);
      else showToast(t('noDownloadOptions'), 'error');
    }

    function findCurrentVideo(root: HTMLElement | null): HTMLVideoElement | undefined {
      const findLoaded = (initialScope: ParentNode): HTMLVideoElement | undefined => {
        const pending: ParentNode[] = [initialScope];
        const visited = new Set<ParentNode>();
        const videos: HTMLVideoElement[] = [];
        while (pending.length) {
          const scope = pending.shift()!;
          if (visited.has(scope)) continue;
          visited.add(scope);
          videos.push(...Array.from(scope.querySelectorAll<HTMLVideoElement>('video')));
          for (const element of Array.from(scope.querySelectorAll<HTMLElement>('*'))) {
            if (element.shadowRoot) pending.push(element.shadowRoot);
          }
        }
        return [...new Set(videos)].filter(video => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0)
          .sort((a, b) => Number(a.paused || a.ended) - Number(b.paused || b.ended))[0];
      };
      return (root ? findLoaded(root) : undefined) ?? findLoaded(document);
    }

    async function downloadCurrentFrame(id: string, root: HTMLElement | null): Promise<void> {
      const video = findCurrentVideo(root);
      if (!video) throw new Error(language === 'es' ? 'No encontré un fotograma disponible en el reproductor.' : 'No decoded video frame is available yet.');
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error(language === 'es' ? 'No se pudo crear el capturador de imagen.' : 'Could not create the image capture canvas.');
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch (error) {
        throw new Error(language === 'es' ? 'El navegador bloqueó la captura del fotograma del video.' : 'The browser blocked capture of this video frame.');
      }
      let base64: string;
      try {
        base64 = canvas.toDataURL('image/jpeg', 0.94).split(',', 2)[1] ?? '';
      } catch {
        throw new Error(language === 'es' ? 'RedGifs no permitió leer los píxeles del fotograma.' : 'RedGifs did not allow reading pixels from this frame.');
      }
      if (!base64) throw new Error(language === 'es' ? 'La captura salió vacía.' : 'The captured frame was empty.');
      const response = await send({
        type: 'RG_DOWNLOAD_FRAME',
        id,
        base64,
        filename: requestedFilename(root, 'frame'),
        useOriginalFilename: originalFilenameEnabled,
      });
      if (!response.ok) throw new Error(response.error);
      showToast(t('captureFrameStarted'));
    }

    async function downloadGifChoice(id: string, choice: DownloadChoice, root: HTMLElement | null): Promise<void> {
      if (choice === 'frame') {
        await downloadCurrentFrame(id, root);
        return;
      }
      const result = await getValidLink(id);
      if (result.kind !== 'ok') throw new Error(result.kind === 'error' ? result.message : t('videoUnavailable'));
      const hdUrl = result.hdVideoUrl ?? result.videoUrl;
      const url = choice === 'image'
        ? hdUrl.replace(/(?:-mobile)?\.mp4(?=([?#]|$))/i, '-mobile.jpg')
        : choice === 'sd' ? mobileVideoUrl(result) : hdUrl;
      const domMeta = scrapeMeta(root ?? document.body);
      const apiMeta = result.metadata;
      const download = await send({
        type: 'RG_DOWNLOAD', id, url, quality: choice,
        filename: requestedFilename(root, choice),
        useOriginalFilename: originalFilenameEnabled,
        ...(choice === 'image' ? {} : {
          title: domMeta.title ?? apiMeta?.title ?? undefined,
          author: domMeta.author ?? apiMeta?.author ?? undefined,
          tags: domMeta.tags.length ? domMeta.tags : (apiMeta?.tags ?? []),
          pageUrl: location.href,
        }),
      });
      if (!download.ok) throw new Error(download.error);
      if (choice === 'image') showToast(t('imageDownloadStarted'));
      else showToast(download.metadata_embedded ? t('downloadStartedMetadata') : (download.metadata_warning ?? t('downloadedWithoutMetadata')), download.metadata_embedded ? 'ok' : 'error');
    }

    function removeDownloadActions(): void {
      document.querySelectorAll('.rg-download-action').forEach(el => el.remove());
      document.querySelectorAll('.rg-embed-download-action').forEach(el => el.remove());
    }

    function paintDownloadAction(): void {
      if (!downloadActionEnabled) {
        removeDownloadActions();
        return;
      }

      const active = getActiveItem();
      // Embedded RedGifs players have no LikeButton sidebar. Always use one
      // compact action inside the player, even while its controls hydrate.
      if (/\/ifr\//i.test(location.pathname)) {
        document.querySelectorAll<HTMLElement>('.rg-download-action').forEach(element => element.remove());
        const id = active?.id ?? WATCH_PATH_RE.exec(location.pathname)?.[1];
        const player = document.querySelector<HTMLElement>('.embeddedPlayer, [class*="embeddedPlayer"]')
          ?? document.querySelector<HTMLElement>('.routeWrapper')
          ?? document.body;
        if (!id || !player) return;
        const existing = document.querySelector<HTMLElement>('.rg-embed-download-action');
        const item = existing ?? document.createElement('div');
        item.className = 'rg-embed-download-action';
        item.dataset.gifId = id;
        item.style.cssText = 'position:absolute;top:8px;right:8px;z-index:2147483646;';
        if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
        if (!item.querySelector('.rg-download-button')) {
          const button = document.createElement('button');
          button.className = 'rg-download-button';
          button.type = 'button';
          button.title = t('downloadWithMetadata');
          button.setAttribute('aria-label', t('downloadVideo'));
          button.style.cssText = 'background:transparent;border:0;color:#fff;cursor:pointer;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-shadow:0 1px 3px #000;';
          button.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M5 17v3h14v-3"/></svg>';
          const label = document.createElement('span');
          label.className = 'label';
          label.textContent = t('download');
          label.style.cssText = 'font:12px Arial,sans-serif;color:#fff;';
          button.appendChild(label);
          button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            requestDownloadChoice(button, quality => {
              button.disabled = true;
              label.textContent = t('preparing');
              void downloadGifChoice(id, quality, player).catch(error => {
                showToast(`✖ ${error instanceof Error ? error.message : t('downloadFailed')}`, 'error');
              }).finally(() => {
                button.disabled = false;
                if (label.isConnected) label.textContent = t('download');
              });
            });
          });
          item.appendChild(button);
        }
        if (item.parentElement !== player) player.appendChild(item);
        return;
      }

      const isVisible = (element: HTMLElement): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 &&
          rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
      };
      // RedGifs reuses/replaces its floating action bar as the feed advances.
      // Anchor to the selected 30%-visible feed item first; a document-wide
      // querySelector picked the first (often offscreen) LikeButton and left
      // our action attached to a previous card.
      const activeHeart = active?.root?.querySelector<HTMLButtonElement>('button.LikeButton');
      const heart = activeHeart && isVisible(activeHeart)
        ? activeHeart
        : Array.from(document.querySelectorAll<HTMLButtonElement>('button.LikeButton')).find(isVisible);
      const heartItem = heart?.closest<HTMLElement>('li.sideBarItem');
      const list = heartItem?.parentElement;
      if (!heart || !heartItem || !list) return;

      let item = document.querySelector<HTMLElement>('.rg-download-action');
      document.querySelectorAll<HTMLElement>('.rg-download-action').forEach(other => {
        if (other !== item) other.remove();
      });
      if (!item) {
        item = document.createElement('li');
      }
      item.className = `${heartItem.className} rg-download-action`;
      if (!item.querySelector('.rg-download-button')) {
        const button = document.createElement('button');
        button.className = `${heart.className.replace(/\bLikeButton\b/g, '').trim()} rg-download-button`;
        button.type = 'button';
        button.title = t('downloadWithMetadata');
        button.setAttribute('aria-label', t('downloadVideo'));
        button.style.cssText = 'background:transparent;border:0;color:#fff;cursor:pointer;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;';
        button.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M5 17v3h14v-3"/></svg>';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = t('download');
        label.style.cssText = 'font-size:12px;color:#fff;';
        button.appendChild(label);
        item.appendChild(button);
        button.addEventListener('click', async event => {
          event.preventDefault();
          event.stopPropagation();
          const active = getActiveItem();
          const id = active?.id || item?.dataset.gifId;
          if (!id) return;
          requestDownloadChoice(button, quality => {
            button.disabled = true;
            label.textContent = t('preparing');
            void downloadGifChoice(id, quality, active?.root ?? null).catch(error => {
              showToast(`✖ ${error instanceof Error ? error.message : t('downloadFailed')}`, 'error');
            }).finally(() => {
              if (label.isConnected) label.textContent = t('download');
              button.disabled = false;
            });
          });
        });
      }
      const button = item.querySelector<HTMLButtonElement>('.rg-download-button');
      if (button) {
        button.title = t('downloadWithMetadata');
        button.setAttribute('aria-label', t('downloadVideo'));
        const label = button.querySelector<HTMLElement>('.label');
        if (label && !button.disabled) label.textContent = t('download');
      }
      if (active?.id) item.dataset.gifId = active.id;
      const next = heartItem.nextElementSibling;
      if (item.parentElement !== list || next !== item) list.insertBefore(item, next);
    }

    function fileToBase64(file: File): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    }

    // ---------- Render ----------
    function renderLoading(id: string): void {
      content.replaceChildren(
        createEl(
          'div',
          'color:#888; font-size:11px; text-align:center; width:100%;',
          t('loading', { id }),
        ),
      );
    }

    function renderError(id: string, result: Exclude<GifLinkResult, { kind: 'ok' }>): void {
      const text =
        result.kind === 'not_found'
          ? t('videoUnavailable')
          : result.kind === 'rate_limited'
            ? t('rateLimited')
            : `✖ ${result.message}`;

      content.replaceChildren(
        createEl(
          'div',
          `background:#2a2a2a; padding:12px; border-radius:8px; border-left:4px solid ${RED}; width:100%; text-align:center; font-size:11px; color:#ddd; animation:zoomIn 0.3s;`,
          text,
        ),
      );

      // Rate limit: reintenta solo una vez pasado un rato prudencial, en vez
      // de dejar al usuario con el mensaje colgado.
      if (result.kind === 'rate_limited') {
        setTimeout(() => {
          if (currentActiveId === id) {
            currentActiveId = null; // fuerza que updatePanel() vuelva a intentar
            void updatePanel();
          }
        }, 5000);
      }
    }

    function renderResult(id: string, result: ResolvedGif, meta: ScrapedMeta, mediaRoot: HTMLElement | null): void {
      const url = result.hdVideoUrl ?? result.videoUrl;
      const imageUrl = result.imageUrl;
      const card = createEl(
        'div',
        `background:#2a2a2a; padding:12px; border-radius:8px; border-left:4px solid ${GREEN}; width:100%; animation:zoomIn 0.3s; display:flex; flex-direction:column; gap:10px;`,
      );

      // Título + id
      const head = createEl('div', '');
      head.append(
        createEl(
          'div',
          'font-weight:bold; font-size:12px; color:#ddd; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;',
          meta.title ? `🎥 ${meta.title}` : t('viewingNow'),
        ),
        createEl('div', 'color:#888; font-size:10px;', meta.author ? `${id} · @${meta.author}` : id),
      );

      // Metadatos detectados: tags + vistas/likes, para confirmar visualmente
      // que el scraping agarró lo correcto antes de guardar.
      const metaBox = createEl(
        'div',
        'display:flex; flex-direction:column; gap:4px; font-size:10px; color:#9fd3ff;',
      );
      if (meta.tags.length) {
        metaBox.append(createEl('div', 'color:#9fd3ff; word-break:break-word;', meta.tags.join(' ')));
      }
      if (meta.views || meta.likes) {
        metaBox.append(
          createEl(
            'div',
            'color:#bbb;',
            `👁 ${meta.views ?? '—'}   ❤ ${meta.likes ?? '—'}`,
          ),
        );
      }

      // --- Zona AZUL: descarga en segundo plano (background.ts) ---
      const dlBox = createEl('div', 'display:flex; flex-direction:column; gap:4px;');
      const dlButton = createEl('button', buttonCss(BLUE, 'white'), t('downloadButton'));
      const dlStatus = createEl('div', 'font-size:10px; color:#aaa; min-height:12px;');
      dlBox.append(dlButton, dlStatus);

      dlButton.addEventListener('click', () => {
        requestDownloadChoice(dlButton, quality => {
          dlButton.disabled = true;
          setStatus(dlStatus, t('downloadingEmbedding'));
          void (async () => {
            if (quality === 'frame') {
              setStatus(dlStatus, t('downloadFrame'));
              await downloadCurrentFrame(id, mediaRoot);
              setStatus(dlStatus, t('captureFrameStarted'), 'ok');
              return;
            }
            const hdUrl = result.hdVideoUrl ?? result.videoUrl;
            const selectedUrl = quality === 'image'
              ? hdUrl.replace(/(?:-mobile)?\.mp4(?=([?#]|$))/i, '-mobile.jpg')
              : quality === 'sd' ? mobileVideoUrl(result) : hdUrl;
            const chosenFilename = requestedFilename(mediaRoot, quality);
            const res = await send({
              type: 'RG_DOWNLOAD', id, url: selectedUrl, quality, filename: chosenFilename,
              useOriginalFilename: originalFilenameEnabled,
              ...(quality === 'image' ? {} : {
                title: meta.title ?? undefined,
                author: meta.author ?? undefined,
                tags: meta.tags,
                pageUrl: location.href,
              }),
            });
            if (!res.ok) throw new Error(res.error);
            if (quality === 'image') {
              setStatus(dlStatus, t('imageDownloadStarted'), 'ok');
              return;
            }
            setStatus(
              dlStatus,
              res.metadata_embedded
                ? t('downloadStartedInFolder')
                : `⚠ ${res.metadata_warning ?? t('downloadedWithoutMetadata')}`,
              res.metadata_embedded ? 'ok' : 'error',
            );
          })().catch(error => setStatus(dlStatus, `✖ ${error instanceof Error ? error.message : t('downloadFailed')}`, 'error'))
            .finally(() => { dlButton.disabled = false; });
        });
      });

      // --- Zona ROJA: capturador de links en SQLite ---
      const dbBox = createEl('div', 'display:flex; flex-direction:column; gap:6px;');
      const saveButton = createEl('button', buttonCss(RED, 'white'), t('saveLinkSqlite'));
      const dbStatus = createEl('div', 'font-size:10px; color:#aaa; min-height:12px;');

      const dbRow = createEl(
        'div',
        'display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:10px; color:#bbb;',
      );
      const autoLabel = createEl('label', 'display:flex; align-items:center; gap:4px; cursor:pointer;');
      const autoCheck = createEl('input', 'margin:0; cursor:pointer;');
      autoCheck.type = 'checkbox';
      autoCheck.checked = autoSave;
      autoLabel.append(autoCheck, document.createTextNode(t('autoSave')));
      const totalEl = createEl('span', 'color:#bbb;', t('savedCount', { count: '…' }));
      dbRow.append(autoLabel, totalEl);

      // Umbral de vistas para el auto-guardado (0 = guarda siempre que esté
      // tildado). Solo aplica cuando "Auto-guardar" está activo.
      const minViewsRow = createEl(
        'div',
        'display:flex; align-items:center; gap:6px; font-size:10px; color:#bbb;',
      );
      const minViewsLabel = createEl('span', 'color:#bbb; white-space:nowrap;', t('minViews'));
      const minViewsInput = createEl(
        'input',
        'width:70px; background:#1c1c1c; color:#ddd; border:1px solid #555; border-radius:4px; font-size:10px; padding:3px 5px; font-family:inherit; box-sizing:border-box;',
      );
      minViewsInput.type = 'number';
      minViewsInput.min = '0';
      minViewsInput.placeholder = '0';
      minViewsInput.value = autoSaveMinViews ? String(autoSaveMinViews) : '';
      minViewsInput.title = t('autoSaveThreshold');
      minViewsInput.addEventListener('change', () => {
        autoSaveMinViews = Math.max(0, Number(minViewsInput.value) || 0);
        void browser.storage.local.set({ [AUTO_SAVE_MIN_VIEWS_KEY]: autoSaveMinViews });
      });
      minViewsRow.append(minViewsLabel, minViewsInput);

      function shouldAutoSave(): boolean {
        if (!autoSave) return false;
        if (autoSaveMinViews <= 0) return true;
        return parseViewsCount(meta.views) >= autoSaveMinViews;
      }

      // Exportar: .sqlite, .db, Excel y HTML (con imágenes incrustadas)
      const exportRow = createEl(
        'div',
        'display:flex; align-items:center; gap:4px; font-size:10px; color:#bbb;',
        t('export'),
      );
      const exportButtons: HTMLButtonElement[] = [];
      const exportFormats: Array<[ExportFormat, string]> = [
        ['sqlite', '.sqlite'],
        ['db', '.db'],
        ['xlsx', 'Excel'],
        ['html', 'HTML'],
      ];
      for (const [format, label] of exportFormats) {
        const btn = createEl(
          'button',
          'flex:1; background:#3a3a3a; color:#ddd; border:1px solid #555; border-radius:4px; cursor:pointer; font-size:10px; padding:4px 0; font-family:inherit;',
          label,
        );
        btn.addEventListener('click', async () => {
          exportButtons.forEach(b => (b.disabled = true));
          setStatus(
            dbStatus,
            format === 'html' ? t('generatingHtml') : t('exporting'),
          );
          const res = await send({ type: 'RG_EXPORT_DB', format, language });
          if (res.ok && res.base64 && res.filename) {
            saveBase64AsFile(res.base64, res.filename, res.mime ?? 'application/octet-stream');
            setStatus(dbStatus, t('exported', { filename: res.filename }), 'ok');
          } else if (!res.ok) {
            setStatus(dbStatus, `✖ ${res.error}`, 'error');
          }
          exportButtons.forEach(b => (b.disabled = false));
        });
        exportButtons.push(btn);
        exportRow.append(btn);
      }
      // Importar un .sqlite/.db exportado desde otro navegador: se fusiona
      // con la base local por gif_id (UNIQUE), así que nunca se duplica.
      const importInput = createEl('input', 'display:none;');
      importInput.type = 'file';
      importInput.accept = '.sqlite,.db';

      const importBtn = createEl(
        'button',
        'width:100%; background:#3a3a3a; color:#9fd3ff; border:1px solid #555; border-radius:4px; cursor:pointer; font-size:10px; padding:6px 0; font-family:inherit;',
        t('importDb'),
      );
      importBtn.addEventListener('click', () => importInput.click());

      importInput.addEventListener('change', async () => {
        const file = importInput.files?.[0];
        if (!file) return;
        importBtn.disabled = true;
        setStatus(dbStatus, t('importing'));
        try {
          const base64 = await fileToBase64(file);
          const res = await send({ type: 'RG_IMPORT_DB', base64 });
          if (res.ok) {
            setStatus(dbStatus, t('importCounts', { imported: res.imported ?? 0, updated: res.updated ?? 0 }), 'ok');
            if (res.total !== undefined) totalEl.textContent = t('savedCount', { count: res.total });
          } else {
            setStatus(dbStatus, `✖ ${res.error}`, 'error');
          }
        } catch {
          setStatus(dbStatus, t('readFileError'), 'error');
        }
        importInput.value = '';
        importBtn.disabled = false;
      });

      dbBox.append(saveButton, dbStatus, dbRow, minViewsRow, exportRow, importBtn, importInput);

      async function saveCurrentLink(): Promise<void> {
        saveButton.disabled = true;
        setStatus(dbStatus, t('saving'));
        // Se re-scrapea justo antes de guardar por si vistas/likes cambiaron
        // mientras el usuario miraba el video.
        const freshItem = document.querySelector<HTMLElement>(ACTIVE_ITEM_SELECTOR);
        const freshMeta =
          freshItem && freshItem.getAttribute('data-feed-item-id') === id ? scrapeMeta(freshItem) : meta;

        const res = await send({
          type: 'RG_SAVE_LINK',
          id,
          url,
          imageUrl,
          pageUrl: location.href,
          title: freshMeta.title ?? undefined,
          author: freshMeta.author ?? undefined,
          tags: freshMeta.tags,
          views: freshMeta.views ?? undefined,
          likes: freshMeta.likes ?? undefined,
        });
        if (res.ok) {
          const alreadySaved = !res.inserted;
          setStatus(dbStatus, alreadySaved ? t('alreadySaved') : t('linkSaved'), 'ok');
          showToast(alreadySaved ? t('alreadySaved') : t('linkSaved'), 'ok');
          if (res.total !== undefined) totalEl.textContent = t('savedCount', { count: res.total });
        } else {
          setStatus(dbStatus, `✖ ${res.error}`, 'error');
          showToast(t('saveFailed', { error: res.error }), 'error');
        }
        saveButton.disabled = false;
      }

      saveButton.addEventListener('click', () => void saveCurrentLink());

      autoCheck.addEventListener('change', () => {
        autoSave = autoCheck.checked;
        void browser.storage.local.set({ [AUTO_SAVE_KEY]: autoSave });
        if (shouldAutoSave()) void saveCurrentLink();
      });

      // --- Zona VERDE: solo abre el video (media.redgifs.com/....mp4) ---
      const viewLink = createEl('a', buttonCss(GREEN, 'black'), t('viewVideo'));
      viewLink.href = url;
      viewLink.target = '_blank';
      viewLink.rel = 'noopener noreferrer';

      card.append(head, metaBox, dlBox, dbBox, viewLink);
      content.replaceChildren(card);

      // Contador inicial y auto-guardado
      void send({ type: 'RG_STATS' }).then(res => {
        if (res.ok && res.total !== undefined) totalEl.textContent = t('savedCount', { count: res.total });
      });
      if (shouldAutoSave()) {
        void saveCurrentLink();
      } else {
        // Chequeo automático: si este video ya está en la DB (de una sesión
        // anterior o de un archivo importado), avisamos sin que el usuario
        // tenga que apretar "Guardar".
        void send({ type: 'RG_CHECK_LINK', id }).then(res => {
          if (res.ok && res.exists && currentActiveId === id) {
            setStatus(dbStatus, t('alreadySaved'), 'ok');
          }
        });
      }
    }

    // ---------- Selección múltiple en grillas (perfiles / tags) ----------
    // Se activa desde el popup (RG_TOGGLE_GRID_SELECT). Dibuja un checkbox
    // sobre cada tileItem visible en el DOM (no hace falta que esté en
    // pantalla: se buscan todos los [data-feed-item-id] del documento), y un
    // botón flotante aparte para guardar todo lo tildado. Es independiente
    // del panel "Video en Pantalla": ese sigue funcionando igual.
    const GRID_CHECKBOX_CLASS = 'rg-grid-checkbox';
    const GRID_BAR_ID = 'rg-grid-bar';
    let gridSelectMode = false;
    const selectedIds = new Map<string, HTMLElement>(); // id -> tileItem root
    const savedIds = new Set<string>(); // ids ya guardados con éxito en esta sesión (siguen marcados, en otro color)

    function findGridItems(): HTMLElement[] {
      return Array.from(document.querySelectorAll<HTMLElement>('[data-feed-item-id]'));
    }

    function itemRootFor(id: string): HTMLElement | undefined {
      return selectedIds.get(id);
    }

    const gridBar = createEl(
      'div',
      'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); z-index:10002; background:rgba(18,18,18,0.98); color:white; padding:10px 14px; border-radius:10px; font-family:sans-serif; border:1px solid #00ff00; box-shadow:0 10px 30px rgba(0,0,0,0.8); display:none; align-items:center; gap:10px; font-size:12px;',
    );
    gridBar.id = GRID_BAR_ID;
    const gridBarCount = createEl('span', 'color:#9fd3ff; white-space:nowrap;', t('selectedCount', { count: 0 }));
    const gridBarSave = createEl('button', buttonCss(RED, 'white') + 'width:auto; padding:8px 14px;', t('saveSelected'));
    const gridBarClear = createEl(
      'button',
      'background:#3a3a3a; color:#ddd; border:1px solid #555; cursor:pointer; padding:8px 12px; border-radius:6px; font-size:12px; font-family:inherit;',
      language === 'en' ? 'Clear' : 'Limpiar',
    );
    const gridBarStatus = createEl('span', 'color:#aaa; font-size:10px; white-space:nowrap;', '');
    gridBar.append(gridBarCount, gridBarSave, gridBarClear, gridBarStatus);
    document.body.appendChild(gridBar);

    function updateGridBar(): void {
      const pending = Array.from(selectedIds.keys()).filter(id => !savedIds.has(id)).length;
      gridBarCount.textContent = savedIds.size > 0
        ? t('selectPendingSaved', { pending, saved: savedIds.size })
        : t('selectedCount', { count: pending });
      gridBar.style.display = gridSelectMode ? 'flex' : 'none';
      gridBarSave.toggleAttribute('disabled', pending === 0);
    }

    const BLUE_SAVED = '#2f9bff';

    type CheckState = 'unselected' | 'selected' | 'saved';

    function checkState(id: string): CheckState {
      if (savedIds.has(id)) return 'saved';
      if (selectedIds.has(id)) return 'selected';
      return 'unselected';
    }

    function checkboxCss(state: CheckState): string {
      const color = state === 'saved' ? BLUE_SAVED : state === 'selected' ? GREEN : '#fff';
      const bg = state === 'unselected' ? 'rgba(0,0,0,0.55)' : color;
      return `position:absolute; top:6px; left:6px; z-index:5; width:22px; height:22px; border-radius:6px; border:2px solid ${color}; background:${bg}; box-shadow:0 1px 4px rgba(0,0,0,0.6); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:bold; color:#000;`;
    }

    function checkboxLabel(state: CheckState): string {
      return state === 'saved' ? '💾' : state === 'selected' ? '✓' : '';
    }

    function applyCheckState(id: string, root: HTMLElement, box: HTMLElement): void {
      const state = checkState(id);
      box.style.cssText = checkboxCss(state);
      box.textContent = checkboxLabel(state);
      if (state === 'unselected') {
        root.style.outline = '';
      } else {
        root.style.outline = `3px solid ${state === 'saved' ? BLUE_SAVED : GREEN}`;
        root.style.outlineOffset = '-3px';
      }
    }

    // Tocar un item ya guardado (💾, azul) lo saca del todo de la marca:
    // vuelve a "unselected" en vez de pasar a "selected" de nuevo, así no
    // se intenta re-guardar por error tocándolo sin querer.
    function toggleSelection(id: string, root: HTMLElement, box: HTMLElement): void {
      if (savedIds.has(id)) {
        savedIds.delete(id);
        selectedIds.delete(id);
      } else if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.set(id, root);
      }
      applyCheckState(id, root, box);
      updateGridBar();
    }

    // Dibuja los checkboxes sobre los tileItem actuales. Se puede volver a
    // llamar (ej. tras cargar más resultados por scroll infinito) sin
    // duplicar: si un item ya tiene su checkbox, se lo salta.
    //
    // El toggle en sí lo maneja SOLO onCaptureClickInGrid (delegado en
    // document, más abajo) — el checkbox no tiene su propio listener de
    // click. Tenerlos a los dos disparaba toggleSelection() dos veces por
    // click (uno por el listener del box, otro por el de document, ambos en
    // fase capture), lo que invertía la selección de vuelta o duplicaba el
    // guardado si justo caía en un número par/impar distinto al esperado.
    function paintGridCheckboxes(): void {
      if (!gridSelectMode) return;
      for (const item of findGridItems()) {
        const id = item.getAttribute('data-feed-item-id');
        if (!id || item.querySelector(`.${GRID_CHECKBOX_CLASS}`)) continue;

        const computed = getComputedStyle(item);
        if (computed.position === 'static') item.style.position = 'relative';

        const box = createEl('div', '', '');
        box.className = GRID_CHECKBOX_CLASS;
        item.appendChild(box);
        applyCheckState(id, item, box);
      }
    }

    // Único punto que decide toggles: intercepta CUALQUIER click dentro de
    // un tileItem (sea sobre el checkbox o sobre el resto de la miniatura)
    // y selecciona en vez de dejar que el <a class="clickArea"> navegue.
    function onCaptureClickInGrid(e: MouseEvent): void {
      if (!gridSelectMode) return;
      const target = e.target as HTMLElement;
      const item = target.closest<HTMLElement>('[data-feed-item-id]');
      if (!item) return;
      const id = item.getAttribute('data-feed-item-id');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      const box = item.querySelector<HTMLElement>(`.${GRID_CHECKBOX_CLASS}`);
      if (box) toggleSelection(id, item, box);
    }
    document.addEventListener('click', onCaptureClickInGrid, true);

    function clearGridCheckboxes(): void {
      document.querySelectorAll(`.${GRID_CHECKBOX_CLASS}`).forEach(el => el.remove());
      for (const root of selectedIds.values()) {
        root.style.outline = '';
      }
    }

    function setGridSelectMode(enabled: boolean): void {
      gridSelectMode = enabled;
      if (!enabled) {
        // Ocultamos los checkboxes y el resaltado, pero NO tocamos
        // selectedIds: apagar el modo es solo una cuestión visual. Si
        // borráramos la selección acá, cualquier apagado-prendido sin
        // querer (ej. el popup resincronizando su estado) perdía todo lo
        // que el usuario ya había tildado.
        clearGridCheckboxes();
      } else {
        paintGridCheckboxes(); // repinta ✓ en los items que ya estaban en selectedIds
      }
      updateGridBar();
    }

    gridBarClear.addEventListener('click', () => {
      // Este es el ÚNICO lugar donde la marca se borra del todo, tanto lo
      // pendiente como lo ya guardado (💾).
      clearGridCheckboxes();
      selectedIds.clear();
      savedIds.clear();
      updateGridBar();
    });

    // Guarda todo lo seleccionado: para cada id, resuelve el video real vía
    // la API (igual que hace el panel individual) y scrapea sus metadatos
    // desde su propio tileItem, sin necesidad de abrir el video.
    gridBarSave.addEventListener('click', async () => {
      const ids = Array.from(selectedIds.keys()).filter(id => !savedIds.has(id));
      if (!ids.length) return;
      gridBarSave.setAttribute('disabled', 'true');
      gridBarClear.setAttribute('disabled', 'true');

      const links: Array<{
        id: string;
        url: string;
        imageUrl?: string;
        pageUrl: string;
        title?: string;
        author?: string;
        tags?: string[];
        views?: string;
        likes?: string;
      }> = [];
      let failed = 0;

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        setStatus(gridBarStatus, `Resolviendo ${i + 1}/${ids.length}...`);
        const result = await getValidLink(id);
        if (result.kind !== 'ok') {
          failed++;
          continue;
        }
        const root = itemRootFor(id);
        const meta = root ? scrapeMeta(root) : { title: null, author: null, tags: [], views: null, likes: null };
        links.push({
          id,
          url: result.videoUrl,
          imageUrl: result.imageUrl,
          pageUrl: location.href,
          title: meta.title ?? undefined,
          author: meta.author ?? undefined,
          tags: meta.tags,
          views: meta.views ?? undefined,
          likes: meta.likes ?? undefined,
        });
      }

      if (!links.length) {
        setStatus(gridBarStatus, t('noItemsResolved'), 'error');
        showToast(t('noItemsSaved'), 'error');
        gridBarSave.removeAttribute('disabled');
        gridBarClear.removeAttribute('disabled');
        return;
      }

      setStatus(gridBarStatus, t('savingDatabase'));
      const res = await send({ type: 'RG_SAVE_BULK', links });
      if (res.ok) {
        const inserted = res.inserted_count ?? 0;
        const updated = res.updated_count ?? 0;
        const summary = `✔ ${inserted} nuevos, ${updated} actualizados${failed ? `, ${failed} fallaron` : ''}`;
        setStatus(gridBarStatus, summary, 'ok');
        showToast(summary, 'ok');
        // No se borra la selección: los que se guardaron bien pasan a
        // "saved" (💾 azul) para que quede claro cuáles ya se procesaron.
        // Solo "Limpiar" los saca del todo.
        for (const link of links) {
          savedIds.add(link.id);
          const root = itemRootFor(link.id);
          const box = root?.querySelector<HTMLElement>(`.${GRID_CHECKBOX_CLASS}`);
          if (root && box) applyCheckState(link.id, root, box);
        }
        updateGridBar();
      } else {
        setStatus(gridBarStatus, `✖ ${res.error}`, 'error');
        showToast(`✖ ${res.error}`, 'error');
      }
      gridBarSave.removeAttribute('disabled');
      gridBarClear.removeAttribute('disabled');
    });

    // Mensajes que vienen del popup (no del background): activar/desactivar
    // el modo selección. Se registra temprano para no perder el primer
    // toggle si el popup se abre apenas cargó la página.
    browser.runtime.onMessage.addListener((message: RgRequest, sender, sendResponse) => {
      if (message.type === 'RG_GET_GRID_SELECT_STATE') {
        const pending = Array.from(selectedIds.keys()).filter(id => !savedIds.has(id)).length;
        sendResponse({
          ok: true,
          enabled: gridSelectMode,
          selected_count: selectedIds.size,
          pending_count: pending,
          saved_count: savedIds.size,
        } satisfies RgResponse);
        return true;
      }
      if (message.type === 'RG_LIST_GRID_SELECTION') {
        // Título "en vivo" desde el propio tileItem (mismo scrapeMeta que
        // usa el resto de la extensión), para que el popup muestre algo
        // reconocible en vez de solo el id crudo.
        const selection = Array.from(selectedIds.entries()).map(([id, root]) => ({
          id,
          title: scrapeMeta(root).title,
          saved: savedIds.has(id),
        }));
        sendResponse({ ok: true, selection } satisfies RgResponse);
        return true;
      }
      if (message.type === 'RG_DESELECT_GRID_ITEM') {
        const root = selectedIds.get(message.id);
        const box = root?.querySelector<HTMLElement>(`.${GRID_CHECKBOX_CLASS}`);
        if (root && box) toggleSelection(message.id, root, box);
        else {
          selectedIds.delete(message.id); // por si el item ya no está en el DOM (scroll lo descargó)
          savedIds.delete(message.id);
        }
        updateGridBar();
        sendResponse({ ok: true, selected_count: selectedIds.size } satisfies RgResponse);
        return true;
      }
      if (message.type !== 'RG_TOGGLE_GRID_SELECT') return undefined;
      const next = message.enabled ?? !gridSelectMode;
      setGridSelectMode(next);
      sendResponse({ ok: true, enabled: next, selected_count: selectedIds.size } satisfies RgResponse);
      return true;
    });

    // ---------- Lógica principal ----------
    // Estrategias de detección, en orden:
    //  1) Página de video individual /watch/<id>: el id sale de la URL, no
    //     hace falta encontrar el elemento en el DOM.
    //  2) Feed de scroll infinito: el item con la clase "activo".
    //  3) Perfiles/grillas sin esa clase: el item con data-feed-item-id más
    //     cercano al centro vertical de la pantalla (best-effort: si el
    //     markup cambia, esto sigue detectando el video en lugar de fallar).
    function getActiveItem(): { id: string; root: HTMLElement | null } | null {
      // On Reddit's RedGifs /ifr/<id> embed, feed-item IDs can be internal
      // UUIDs. The iframe URL contains the actual RedGifs ID used in media
      // filenames, so prefer it before inspecting those generated wrappers.
      const iframeId = /\/ifr\/([\w-]+)/i.exec(location.pathname)?.[1];
      if (iframeId) {
        const root = document.querySelector<HTMLElement>('.embeddedPlayer, [class*="embeddedPlayer"]');
        return { id: iframeId, root };
      }
      // En el feed continuo, cambia al siguiente video tan pronto como al
      // menos el 30% de su tarjeta entra en el viewport. Elegir por centro
      // hacía que el icono de descarga se quedara asociado al video anterior
      // durante demasiado scroll.
      const items = Array.from(document.querySelectorAll<HTMLElement>('[data-feed-item-id]'));
      if (items.length) {
        const candidates: Array<{ id: string; el: HTMLElement; top: number }> = [];
        for (const item of items) {
          const rect = item.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
          const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
          const visibleRatio = (visibleHeight * visibleWidth) / (rect.height * rect.width);
          if (visibleRatio < 0.3) continue;
          const id = item.getAttribute('data-feed-item-id');
          if (!id || id.includes('feed-module')) continue;
          candidates.push({ id, el: item, top: rect.top });
        }
        if (candidates.length) {
          candidates.sort((a, b) => a.top - b.top);
          const next = scrollDirection === 'down' ? candidates.at(-1)! : candidates[0]!;
          return { id: next.id, root: next.el };
        }
      }

      const active = document.querySelector<HTMLElement>(ACTIVE_ITEM_SELECTOR);
      const activeId = active?.getAttribute('data-feed-item-id');
      if (active && activeId) return { id: activeId, root: active };

      // Último fallback: id de la URL /watch/<id>. Solo se usa cuando no
      // hay NADA detectable en el DOM (ej. la página cargó sin feed de
      // relacionados todavía, o el markup cambió por completo).
      const watchMatch = WATCH_PATH_RE.exec(location.pathname);
      if (watchMatch?.[1]) {
        const id = watchMatch[1];
        const root = document.querySelector<HTMLElement>(`[data-feed-item-id="${id}"]`);
        return { id, root };
      }

      return null;
    }

    async function updatePanel(): Promise<void> {
      const found = getActiveItem();
      if (!found) return;
      const { id, root } = found;

      // SOLO ACTUALIZAR SI EL VIDEO ES DISTINTO AL QUE YA TENEMOS
      if (!id || id === currentActiveId || id.includes('feed-module')) return;
      if (panelRetryTimer) {
        clearTimeout(panelRetryTimer);
        panelRetryTimer = null;
      }
      if (panelRetryId !== id) {
        panelRetryId = id;
        panelRetryCount = 0;
      }
      currentActiveId = id;

      renderLoading(id);
      const result = await getValidLink(id);

      // Verificamos que sigamos en el mismo video antes de mostrar el link
      if (currentActiveId !== id) return;

      if (result.kind === 'ok') {
        panelRetryCount = 0;
        panelRetryId = null;
        // Si no encontramos el item en el DOM (típico en /watch sin el
        // markup del feed), se scrapea sobre toda la página como fallback.
        const scraped = scrapeMeta(root ?? document.body);
        // RedGifs puede renderizar distinto en Firefox. Completa los campos
        // ausentes con la respuesta oficial de la API, que ya resolvió el ID.
        const apiMeta = result.metadata;
        const meta: ScrapedMeta = {
          ...scraped,
          title: scraped.title ?? apiMeta?.title ?? null,
          author: scraped.author ?? apiMeta?.author ?? null,
          tags: scraped.tags.length ? scraped.tags : (apiMeta?.tags ?? []),
        };
        renderResult(id, result, meta, root);
      } else {
        renderError(id, result);
        // Si el service worker/background no respondió, no dejamos el panel
        // clavado en ese error: reintentamos unas pocas veces. Scroll o una
        // navegación a otro gif también vuelven a ejecutar la detección.
        if (
          result.kind === 'error' &&
          /background|contactar con la extensión|sin respuesta/i.test(result.message) &&
          panelRetryCount < 3
        ) {
          panelRetryCount++;
          panelRetryTimer = setTimeout(() => {
            panelRetryTimer = null;
            if (currentActiveId === id) {
              currentActiveId = null;
              void updatePanel();
            }
          }, 1200 * panelRetryCount);
        }
      }
    }

    // Agrupa muchos eventos seguidos en una sola ejecución por frame
    let scheduled = false;
    function handleScroll(event: Event): void {
      const target = event.target;
      let offset: number | null = null;
      if (target === window) offset = window.scrollY;
      else if (target === document) offset = document.scrollingElement?.scrollTop ?? window.scrollY;
      else if (target instanceof Element) offset = target.scrollTop;
      if (target && typeof target === 'object' && offset !== null) {
        const previous = previousScrollOffsets.get(target);
        if (previous !== undefined && offset !== previous) scrollDirection = offset > previous ? 'down' : 'up';
        previousScrollOffsets.set(target, offset);
      }
      scheduleUpdate();
    }

    function scheduleUpdate(): void {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        void updatePanel();
        paintDownloadAction();
        if (gridSelectMode) paintGridCheckboxes(); // cubre items nuevos del scroll infinito
      });
    }

    // Detecta navegación SPA (ej. clic en un video del feed que lleva a
    // /watch/<id> sin recargar la página), que no siempre dispara mutaciones
    // de clase en el body.
    function patchHistoryForSpaNav(onNavigate: () => void): void {
      const wrap =
        (fn: History['pushState']) =>
        (...args: Parameters<History['pushState']>) => {
          const ret = fn.apply(history, args);
          onNavigate();
          return ret;
        };
      history.pushState = wrap(history.pushState);
      history.replaceState = wrap(history.replaceState);
      window.addEventListener('popstate', onNavigate);
    }

    // ---------- Inicio ----------
    const observer = new MutationObserver(scheduleUpdate);

    void (async () => {
      const stored = await browser.storage.local.get([
        AUTO_SAVE_KEY,
        AUTO_SAVE_MIN_VIEWS_KEY,
        PANEL_POSITION_KEY,
        PANEL_COLLAPSED_KEY,
        PANEL_ENABLED_KEY,
        DOWNLOAD_ACTION_ENABLED_KEY,
        DOWNLOAD_QUALITY_KEY,
        DOWNLOAD_OPTIONS_KEY,
        ORIGINAL_FILENAME_KEY,
        LANGUAGE_KEY,
      ]);
      autoSave = stored[AUTO_SAVE_KEY] === true;
      autoSaveMinViews = typeof stored[AUTO_SAVE_MIN_VIEWS_KEY] === 'number' ? stored[AUTO_SAVE_MIN_VIEWS_KEY] : 0;
      panelPositionIdx = typeof stored[PANEL_POSITION_KEY] === 'number' ? stored[PANEL_POSITION_KEY] : 0;
      panelCollapsed = stored[PANEL_COLLAPSED_KEY] === true;
      panelEnabled = stored[PANEL_ENABLED_KEY] === true;
      downloadActionEnabled = stored[DOWNLOAD_ACTION_ENABLED_KEY] !== false;
      downloadOptions = normalizeDownloadOptions(stored[DOWNLOAD_OPTIONS_KEY], stored[DOWNLOAD_QUALITY_KEY]);
      originalFilenameEnabled = stored[ORIGINAL_FILENAME_KEY] !== false;
      language = stored[LANGUAGE_KEY] === 'es' ? 'es' : 'en';
      panel.querySelector('#rg-panel-title')!.textContent = t('panelTitle');
      moveBtn.title = t('movePanel');
      collapseBtn.title = t('minimize');
      gridBarSave.textContent = t('saveSelected');
      gridBarClear.textContent = language === 'en' ? 'Clear' : 'Limpiar';
      updateGridBar();
      panel.style.display = panelEnabled ? 'flex' : 'none';

      applyPanelPosition(panelPositionIdx);
      if (panelCollapsed) {
        content.style.display = 'none';
        collapseBtn.textContent = '+';
      }

      ctx.addEventListener(window, 'scroll', handleScroll, { passive: true });
      ctx.addEventListener(document, 'scroll', handleScroll, { capture: true, passive: true });
      observer.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['class'],
      });
      patchHistoryForSpaNav(scheduleUpdate);
      scheduleUpdate();
      paintDownloadAction();
    })();

    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes[PANEL_ENABLED_KEY]) {
        panelEnabled = changes[PANEL_ENABLED_KEY].newValue === true;
        panel.style.display = panelEnabled ? 'flex' : 'none';
      }
      if (changes[DOWNLOAD_ACTION_ENABLED_KEY]) {
        downloadActionEnabled = changes[DOWNLOAD_ACTION_ENABLED_KEY].newValue !== false;
        paintDownloadAction();
      }
      if (changes[DOWNLOAD_OPTIONS_KEY]) {
        downloadOptions = normalizeDownloadOptions(changes[DOWNLOAD_OPTIONS_KEY].newValue);
      } else if (changes[DOWNLOAD_QUALITY_KEY] && !changes[DOWNLOAD_OPTIONS_KEY]) {
        downloadOptions = normalizeDownloadOptions(undefined, changes[DOWNLOAD_QUALITY_KEY].newValue);
      }
      if (changes[ORIGINAL_FILENAME_KEY]) originalFilenameEnabled = changes[ORIGINAL_FILENAME_KEY].newValue !== false;
      if (changes[LANGUAGE_KEY]) {
        language = changes[LANGUAGE_KEY].newValue === 'es' ? 'es' : 'en';
        panel.querySelector('#rg-panel-title')!.textContent = t('panelTitle');
        moveBtn.title = t('movePanel');
        collapseBtn.title = t('minimize');
        gridBarSave.textContent = t('saveSelected');
        gridBarClear.textContent = language === 'en' ? 'Clear' : 'Limpiar';
        updateGridBar();
        currentActiveId = null;
        paintDownloadAction();
        scheduleUpdate();
      }
    });

    // Limpieza si la extensión se recarga o se desinstala
    ctx.onInvalidated(() => {
      observer.disconnect();
      document.removeEventListener('click', onCaptureClickInGrid, true);
      clearGridCheckboxes();
      panel.remove();
      gridBar.remove();
      style.remove();
    });
  },
});
