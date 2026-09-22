import type { ExportFormat, RgRequest, RgResponse } from '../utils/messages';

export default defineContentScript({
  matches: ['*://*.redgifs.com/*'],

  main(ctx) {
    // ---------- Tipos de la API de RedGifs ----------
    interface AuthResponse {
      token: string;
    }
    interface GifResponse {
      gif: {
        urls: {
          hd?: string;
          sd?: string;
          thumbnail?: string; // ej.: .../Nombre-mobile.jpg
          poster?: string;
        };
      };
    }

    // ---------- Constantes ----------
    const API = 'https://api.redgifs.com/v2';
    const PANEL_ID = 'rg-scroller-panel';
    const STYLE_ID = 'rg-scroller-style';
    // Selector "feliz" del feed de scroll infinito. Si RedGifs cambia el
    // markup y esto deja de matchear, getActiveItem() igual sigue andando
    // en /watch/<id> (lee el id de la URL) y en perfiles/grillas (usa el
    // item con data-feed-item-id más cercano al centro de la pantalla).
    const ACTIVE_ITEM_SELECTOR = '.GifPreview.GifPreview_isActive[data-feed-item-id]';
    const WATCH_PATH_RE = /\/watch\/([\w-]+)/;
    const AUTO_SAVE_KEY = 'rgAutoSave';
    const AUTO_SAVE_MIN_VIEWS_KEY = 'rgAutoSaveMinViews';
    const PANEL_POSITION_KEY = 'rgPanelPosition';
    const PANEL_COLLAPSED_KEY = 'rgPanelCollapsed';

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
        <span>🎯 Video en Pantalla</span>
        <div style="margin-left:auto; display:flex; gap:6px;">
          <button id="rg-move-btn" title="Cambiar posición" style="background:transparent; border:none; color:#9fd3ff; font-size:13px; cursor:pointer; font-family:inherit; padding:0 2px;">⇄</button>
          <button id="rg-collapse-btn" title="Minimizar" style="background:transparent; border:none; color:#00ff00; font-size:14px; font-weight:bold; cursor:pointer; font-family:inherit; padding:0 2px;">–</button>
        </div>
      </div>
      <div id="rg-content" style="font-size:12px; min-height:80px; display:flex; align-items:center; justify-content:center;">
        <p style="color:#888; text-align:center;">Mueve el scroll para detectar el video...</p>
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
    let authToken = '';
    let autoSave = false;
    let autoSaveMinViews = 0;
    let panelPositionIdx = 0;
    let panelCollapsed = false;

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
        return res ?? { ok: false, error: 'Sin respuesta del background' };
      } catch {
        return { ok: false, error: 'No se pudo contactar con la extensión. Recarga la página.' };
      }
    }

    // ---------- API de RedGifs ----------
    async function refreshAuth(): Promise<void> {
      try {
        const resp = await fetch(`${API}/auth/temporary`);
        const data = (await resp.json()) as AuthResponse;
        authToken = data.token;
      } catch (e) {
        console.error('[RG Scroller] Error al obtener el token', e);
      }
    }

    type GifLinkResult =
      | { kind: 'ok'; videoUrl: string; imageUrl: string }
      | { kind: 'not_found' }
      | { kind: 'rate_limited' }
      | { kind: 'error'; message: string };

    async function getValidLink(id: string, retry = true): Promise<GifLinkResult> {
      if (!authToken) await refreshAuth();
      try {
        const response = await fetch(`${API}/gifs/${id}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        // Token vencido: se renueva y se reintenta UNA sola vez
        if (response.status === 401 && retry) {
          await refreshAuth();
          return getValidLink(id, false);
        }
        if (response.status === 404) return { kind: 'not_found' };
        if (response.status === 429) return { kind: 'rate_limited' };
        if (!response.ok) return { kind: 'error', message: `Error ${response.status} al consultar la API` };

        const data = (await response.json()) as GifResponse;
        const { hd, sd, thumbnail, poster } = data.gif.urls;
        const videoUrl = hd ?? sd;
        // Sin hd ni sd: video privado, borrado, o aún procesándose.
        if (!videoUrl) return { kind: 'not_found' };
        // Si la API no trae miniatura, se usa el patrón <Nombre>-mobile.jpg
        const imageUrl = thumbnail ?? poster ?? videoUrl.replace(/\.[a-z0-9]+$/i, '-mobile.jpg');
        return { kind: 'ok', videoUrl, imageUrl };
      } catch (e) {
        console.error('[RG Scroller] Error al obtener el video', e);
        return { kind: 'error', message: 'No se pudo conectar con la API de RedGifs' };
      }
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
          `Cargando datos de: ${id}...`,
        ),
      );
    }

    function renderError(id: string, result: Exclude<GifLinkResult, { kind: 'ok' }>): void {
      const text =
        result.kind === 'not_found'
          ? '🚫 Video no disponible (borrado, privado o aún procesándose)'
          : result.kind === 'rate_limited'
            ? '⏳ RedGifs está limitando los pedidos, esperá unos segundos...'
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

    function renderResult(id: string, url: string, imageUrl: string, meta: ScrapedMeta): void {
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
          meta.title ? `🎥 ${meta.title}` : '🎥 Viendo ahora:',
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
      const dlButton = createEl('button', buttonCss(BLUE, 'white'), '⬇ DESCARGAR (segundo plano)');
      const dlStatus = createEl('div', 'font-size:10px; color:#aaa; min-height:12px;');
      dlBox.append(dlButton, dlStatus);

      dlButton.addEventListener('click', async () => {
        dlButton.disabled = true;
        setStatus(dlStatus, 'Enviando al background...');
        const res = await send({ type: 'RG_DOWNLOAD', id, url });
        if (res.ok) setStatus(dlStatus, '✔ Descarga iniciada (carpeta Descargas/redgifs)', 'ok');
        else setStatus(dlStatus, `✖ ${res.error}`, 'error');
        dlButton.disabled = false;
      });

      // --- Zona ROJA: capturador de links en SQLite ---
      const dbBox = createEl('div', 'display:flex; flex-direction:column; gap:6px;');
      const saveButton = createEl('button', buttonCss(RED, 'white'), '💾 GUARDAR LINK EN SQLITE');
      const dbStatus = createEl('div', 'font-size:10px; color:#aaa; min-height:12px;');

      const dbRow = createEl(
        'div',
        'display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:10px; color:#bbb;',
      );
      const autoLabel = createEl('label', 'display:flex; align-items:center; gap:4px; cursor:pointer;');
      const autoCheck = createEl('input', 'margin:0; cursor:pointer;');
      autoCheck.type = 'checkbox';
      autoCheck.checked = autoSave;
      autoLabel.append(autoCheck, document.createTextNode('Auto-guardar'));
      const totalEl = createEl('span', 'color:#bbb;', 'Guardados: …');
      dbRow.append(autoLabel, totalEl);

      // Umbral de vistas para el auto-guardado (0 = guarda siempre que esté
      // tildado). Solo aplica cuando "Auto-guardar" está activo.
      const minViewsRow = createEl(
        'div',
        'display:flex; align-items:center; gap:6px; font-size:10px; color:#bbb;',
      );
      const minViewsLabel = createEl('span', 'color:#bbb; white-space:nowrap;', 'Mín. vistas:');
      const minViewsInput = createEl(
        'input',
        'width:70px; background:#1c1c1c; color:#ddd; border:1px solid #555; border-radius:4px; font-size:10px; padding:3px 5px; font-family:inherit; box-sizing:border-box;',
      );
      minViewsInput.type = 'number';
      minViewsInput.min = '0';
      minViewsInput.placeholder = '0';
      minViewsInput.value = autoSaveMinViews ? String(autoSaveMinViews) : '';
      minViewsInput.title = 'Auto-guardar solo si supera este número de vistas (vacío = siempre)';
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
        'Exportar:',
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
            format === 'html' ? 'Generando HTML (descargando imágenes)...' : 'Exportando...',
          );
          const res = await send({ type: 'RG_EXPORT_DB', format });
          if (res.ok && res.base64 && res.filename) {
            saveBase64AsFile(res.base64, res.filename, res.mime ?? 'application/octet-stream');
            setStatus(dbStatus, `✔ Exportado: ${res.filename}`, 'ok');
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
        '📥 Importar DB (fusionar, sin duplicar)',
      );
      importBtn.addEventListener('click', () => importInput.click());

      importInput.addEventListener('change', async () => {
        const file = importInput.files?.[0];
        if (!file) return;
        importBtn.disabled = true;
        setStatus(dbStatus, 'Importando y fusionando...');
        try {
          const base64 = await fileToBase64(file);
          const res = await send({ type: 'RG_IMPORT_DB', base64 });
          if (res.ok) {
            setStatus(dbStatus, `✔ ${res.imported ?? 0} nuevos, ${res.updated ?? 0} actualizados`, 'ok');
            if (res.total !== undefined) totalEl.textContent = `Guardados: ${res.total}`;
          } else {
            setStatus(dbStatus, `✖ ${res.error}`, 'error');
          }
        } catch {
          setStatus(dbStatus, '✖ No se pudo leer el archivo', 'error');
        }
        importInput.value = '';
        importBtn.disabled = false;
      });

      dbBox.append(saveButton, dbStatus, dbRow, minViewsRow, exportRow, importBtn, importInput);

      async function saveCurrentLink(): Promise<void> {
        saveButton.disabled = true;
        setStatus(dbStatus, 'Guardando...');
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
          setStatus(dbStatus, alreadySaved ? 'ℹ Este link ya estaba guardado' : '✔ Link guardado', 'ok');
          showToast(alreadySaved ? 'ℹ Este link ya estaba guardado' : '✔ Link guardado', 'ok');
          if (res.total !== undefined) totalEl.textContent = `Guardados: ${res.total}`;
        } else {
          setStatus(dbStatus, `✖ ${res.error}`, 'error');
          showToast(`✖ No se pudo guardar: ${res.error}`, 'error');
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
      const viewLink = createEl('a', buttonCss(GREEN, 'black'), '▶ VER VIDEO');
      viewLink.href = url;
      viewLink.target = '_blank';
      viewLink.rel = 'noopener noreferrer';

      card.append(head, metaBox, dlBox, dbBox, viewLink);
      content.replaceChildren(card);

      // Contador inicial y auto-guardado
      void send({ type: 'RG_STATS' }).then(res => {
        if (res.ok && res.total !== undefined) totalEl.textContent = `Guardados: ${res.total}`;
      });
      if (shouldAutoSave()) {
        void saveCurrentLink();
      } else {
        // Chequeo automático: si este video ya está en la DB (de una sesión
        // anterior o de un archivo importado), avisamos sin que el usuario
        // tenga que apretar "Guardar".
        void send({ type: 'RG_CHECK_LINK', id }).then(res => {
          if (res.ok && res.exists && currentActiveId === id) {
            setStatus(dbStatus, 'ℹ Este link ya estaba guardado', 'ok');
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
    const gridBarCount = createEl('span', 'color:#9fd3ff; white-space:nowrap;', '0 seleccionados');
    const gridBarSave = createEl('button', buttonCss(RED, 'white') + 'width:auto; padding:8px 14px;', '💾 Guardar seleccionados');
    const gridBarClear = createEl(
      'button',
      'background:#3a3a3a; color:#ddd; border:1px solid #555; cursor:pointer; padding:8px 12px; border-radius:6px; font-size:12px; font-family:inherit;',
      'Limpiar',
    );
    const gridBarStatus = createEl('span', 'color:#aaa; font-size:10px; white-space:nowrap;', '');
    gridBar.append(gridBarCount, gridBarSave, gridBarClear, gridBarStatus);
    document.body.appendChild(gridBar);

    function updateGridBar(): void {
      gridBarCount.textContent = `${selectedIds.size} seleccionados`;
      gridBar.style.display = gridSelectMode ? 'flex' : 'none';
      gridBarSave.toggleAttribute('disabled', selectedIds.size === 0);
    }

    function checkboxCss(checked: boolean): string {
      return `position:absolute; top:6px; left:6px; z-index:5; width:22px; height:22px; border-radius:6px; border:2px solid ${
        checked ? GREEN : '#fff'
      }; background:${checked ? GREEN : 'rgba(0,0,0,0.55)'}; box-shadow:0 1px 4px rgba(0,0,0,0.6); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:bold; color:#000;`;
    }

    function toggleSelection(id: string, root: HTMLElement, box: HTMLElement): void {
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
        box.style.cssText = checkboxCss(false);
        box.textContent = '';
        root.style.outline = '';
      } else {
        selectedIds.set(id, root);
        box.style.cssText = checkboxCss(true);
        box.textContent = '✓';
        root.style.outline = `3px solid ${GREEN}`;
        root.style.outlineOffset = '-3px';
      }
      updateGridBar();
    }

    // Dibuja los checkboxes sobre los tileItem actuales. Se puede volver a
    // llamar (ej. tras cargar más resultados por scroll infinito) sin
    // duplicar: si un item ya tiene su checkbox, se lo salta.
    function paintGridCheckboxes(): void {
      if (!gridSelectMode) return;
      for (const item of findGridItems()) {
        const id = item.getAttribute('data-feed-item-id');
        if (!id || item.querySelector(`.${GRID_CHECKBOX_CLASS}`)) continue;

        const computed = getComputedStyle(item);
        if (computed.position === 'static') item.style.position = 'relative';

        const box = createEl('div', checkboxCss(selectedIds.has(id)), selectedIds.has(id) ? '✓' : '');
        box.className = GRID_CHECKBOX_CLASS;
        box.addEventListener(
          'click',
          e => {
            e.preventDefault();
            e.stopPropagation();
            toggleSelection(id, item, box);
          },
          true,
        );
        item.appendChild(box);
        if (selectedIds.has(id)) {
          item.style.outline = `3px solid ${GREEN}`;
          item.style.outlineOffset = '-3px';
        }
      }
    }

    // Mientras el modo selección está activo, un click en cualquier parte
    // del tileItem (fuera del checkbox) también selecciona en vez de abrir
    // el video: se intercepta el <a class="clickArea"> con capture.
    function onCaptureClickInGrid(e: MouseEvent): void {
      if (!gridSelectMode) return;
      const target = e.target as HTMLElement;
      if (target.classList.contains(GRID_CHECKBOX_CLASS)) return; // ya lo maneja su propio listener
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
        clearGridCheckboxes();
        selectedIds.clear();
      } else {
        paintGridCheckboxes();
      }
      updateGridBar();
    }

    gridBarClear.addEventListener('click', () => {
      clearGridCheckboxes();
      selectedIds.clear();
      updateGridBar();
    });

    // Guarda todo lo seleccionado: para cada id, resuelve el video real vía
    // la API (igual que hace el panel individual) y scrapea sus metadatos
    // desde su propio tileItem, sin necesidad de abrir el video.
    gridBarSave.addEventListener('click', async () => {
      const ids = Array.from(selectedIds.keys());
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
        setStatus(gridBarStatus, '✖ No se pudo resolver ninguno', 'error');
        showToast('✖ No se pudo guardar ninguno', 'error');
        gridBarSave.removeAttribute('disabled');
        gridBarClear.removeAttribute('disabled');
        return;
      }

      setStatus(gridBarStatus, 'Guardando en la base...');
      const res = await send({ type: 'RG_SAVE_BULK', links });
      if (res.ok) {
        const inserted = res.inserted_count ?? 0;
        const updated = res.updated_count ?? 0;
        const summary = `✔ ${inserted} nuevos, ${updated} actualizados${failed ? `, ${failed} fallaron` : ''}`;
        setStatus(gridBarStatus, summary, 'ok');
        showToast(summary, 'ok');
        clearGridCheckboxes();
        selectedIds.clear();
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
      if (message.type !== 'RG_TOGGLE_GRID_SELECT') return undefined;
      const next = message.enabled ?? !gridSelectMode;
      setGridSelectMode(next);
      sendResponse({ ok: true, enabled: next } satisfies RgResponse);
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
      // 1) Feed de scroll infinito (incluye el de videos relacionados que
      // aparece debajo del video principal en /watch/<id>): esto es lo más
      // confiable y va PRIMERO, porque en /watch/<id> la URL no cambia
      // aunque sigas scrolleando a otros videos.
      const active = document.querySelector<HTMLElement>(ACTIVE_ITEM_SELECTOR);
      if (active) {
        const id = active.getAttribute('data-feed-item-id');
        if (id) return { id, root: active };
      }

      // 2) Sin clase "activa" (perfiles/grillas): el item con
      // data-feed-item-id más cercano al centro vertical de la pantalla.
      const items = Array.from(document.querySelectorAll<HTMLElement>('[data-feed-item-id]'));
      if (items.length) {
        const viewportCenter = window.innerHeight / 2;
        let best: { id: string; el: HTMLElement; dist: number } | null = null;
        for (const item of items) {
          const rect = item.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > window.innerHeight) continue; // fuera de vista
          const id = item.getAttribute('data-feed-item-id');
          if (!id) continue;
          const dist = Math.abs(rect.top + rect.height / 2 - viewportCenter);
          if (!best || dist < best.dist) best = { id, el: item, dist };
        }
        if (best) return { id: best.id, root: best.el };
      }

      // 3) Último fallback: id de la URL /watch/<id>. Solo se usa cuando no
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
      currentActiveId = id;

      renderLoading(id);
      const result = await getValidLink(id);

      // Verificamos que sigamos en el mismo video antes de mostrar el link
      if (currentActiveId !== id) return;

      if (result.kind === 'ok') {
        // Si no encontramos el item en el DOM (típico en /watch sin el
        // markup del feed), se scrapea sobre toda la página como fallback.
        const meta = scrapeMeta(root ?? document.body);
        renderResult(id, result.videoUrl, result.imageUrl, meta);
      } else {
        renderError(id, result);
      }
    }

    // Agrupa muchos eventos seguidos en una sola ejecución por frame
    let scheduled = false;
    function scheduleUpdate(): void {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        void updatePanel();
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
      ]);
      autoSave = stored[AUTO_SAVE_KEY] === true;
      autoSaveMinViews = typeof stored[AUTO_SAVE_MIN_VIEWS_KEY] === 'number' ? stored[AUTO_SAVE_MIN_VIEWS_KEY] : 0;
      panelPositionIdx = typeof stored[PANEL_POSITION_KEY] === 'number' ? stored[PANEL_POSITION_KEY] : 0;
      panelCollapsed = stored[PANEL_COLLAPSED_KEY] === true;

      applyPanelPosition(panelPositionIdx);
      if (panelCollapsed) {
        content.style.display = 'none';
        collapseBtn.textContent = '+';
      }

      await refreshAuth();

      ctx.addEventListener(window, 'scroll', scheduleUpdate, { passive: true });
      observer.observe(document.body, {
        attributes: true,
        subtree: true,
        attributeFilter: ['class'],
      });
      patchHistoryForSpaNav(scheduleUpdate);
      scheduleUpdate();
    })();

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