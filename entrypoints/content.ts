import type { RgRequest, RgResponse } from '../utils/messages';

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
        };
      };
    }

    // ---------- Constantes ----------
    const API = 'https://api.redgifs.com/v2';
    const PANEL_ID = 'rg-scroller-panel';
    const STYLE_ID = 'rg-scroller-style';
    const ACTIVE_ITEM_SELECTOR = '.GifPreview.GifPreview_isActive[data-feed-item-id]';
    const AUTO_SAVE_KEY = 'rgAutoSave';

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

    // Eliminar panel y estilo anteriores si existen
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText =
      'position:fixed; bottom:20px; left:20px; z-index:10000; background:rgba(18,18,18,0.98); color:white; padding:15px; border-radius:12px; font-family:sans-serif; width:300px; border:1px solid #00ff00; box-shadow:0 10px 30px rgba(0,0,0,0.8); display:flex; flex-direction:column;';
    panel.innerHTML = `
      <div style="font-weight:bold; border-bottom:1px solid #444; padding-bottom:10px; margin-bottom:10px; color:#00ff00; display:flex; align-items:center; gap:8px;">
        <span>🎯 Video en Pantalla</span>
      </div>
      <div id="rg-content" style="font-size:12px; min-height:80px; display:flex; align-items:center; justify-content:center;">
        <p style="color:#888; text-align:center;">Mueve el scroll para detectar el video...</p>
      </div>
    `;
    document.body.appendChild(panel);

    const content = panel.querySelector<HTMLDivElement>('#rg-content')!;

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

    async function getValidLink(id: string, retry = true): Promise<string | null> {
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
        if (!response.ok) return null;
        const data = (await response.json()) as GifResponse;
        return data.gif.urls.hd ?? data.gif.urls.sd ?? null;
      } catch (e) {
        console.error('[RG Scroller] Error al obtener el video', e);
        return null;
      }
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

    function renderResult(id: string, url: string): void {
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
          '🎥 Viendo ahora:',
        ),
        createEl('div', 'color:#888; font-size:10px;', id),
      );

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
      const exportButton = createEl(
        'button',
        'background:#3a3a3a; color:#ddd; border:1px solid #555; border-radius:4px; cursor:pointer; font-size:10px; padding:3px 6px; font-family:inherit;',
        'Exportar .sqlite',
      );
      dbRow.append(autoLabel, totalEl, exportButton);
      dbBox.append(saveButton, dbStatus, dbRow);

      async function saveCurrentLink(): Promise<void> {
        saveButton.disabled = true;
        setStatus(dbStatus, 'Guardando...');
        const res = await send({ type: 'RG_SAVE_LINK', id, url, pageUrl: location.href });
        if (res.ok) {
          setStatus(dbStatus, res.inserted ? '✔ Link guardado' : 'ℹ Este link ya estaba guardado', 'ok');
          if (res.total !== undefined) totalEl.textContent = `Guardados: ${res.total}`;
        } else {
          setStatus(dbStatus, `✖ ${res.error}`, 'error');
        }
        saveButton.disabled = false;
      }

      saveButton.addEventListener('click', () => void saveCurrentLink());

      autoCheck.addEventListener('change', () => {
        autoSave = autoCheck.checked;
        void browser.storage.local.set({ [AUTO_SAVE_KEY]: autoSave });
        if (autoSave) void saveCurrentLink();
      });

      exportButton.addEventListener('click', async () => {
        exportButton.disabled = true;
        const res = await send({ type: 'RG_EXPORT_DB' });
        if (res.ok && res.base64) {
          saveBase64AsFile(res.base64, 'redgifs-links.sqlite', 'application/vnd.sqlite3');
          setStatus(dbStatus, '✔ Base exportada: redgifs-links.sqlite', 'ok');
        } else if (!res.ok) {
          setStatus(dbStatus, `✖ ${res.error}`, 'error');
        }
        exportButton.disabled = false;
      });

      // --- Zona VERDE: solo abre el video (media.redgifs.com/....mp4) ---
      const viewLink = createEl('a', buttonCss(GREEN, 'black'), '▶ VER VIDEO');
      viewLink.href = url;
      viewLink.target = '_blank';
      viewLink.rel = 'noopener noreferrer';

      card.append(head, dlBox, dbBox, viewLink);
      content.replaceChildren(card);

      // Contador inicial y auto-guardado
      void send({ type: 'RG_STATS' }).then(res => {
        if (res.ok && res.total !== undefined) totalEl.textContent = `Guardados: ${res.total}`;
      });
      if (autoSave) void saveCurrentLink();
    }

    // ---------- Lógica principal ----------
    async function updatePanel(): Promise<void> {
      // Buscar el video que tiene la clase ACTIVE
      const activeItem = document.querySelector<HTMLElement>(ACTIVE_ITEM_SELECTOR);
      if (!activeItem) return;

      const id = activeItem.getAttribute('data-feed-item-id');

      // SOLO ACTUALIZAR SI EL VIDEO ES DISTINTO AL QUE YA TENEMOS
      if (!id || id === currentActiveId || id.includes('feed-module')) return;
      currentActiveId = id;

      renderLoading(id);
      const realUrl = await getValidLink(id);

      // Verificamos que sigamos en el mismo video antes de mostrar el link
      if (realUrl && currentActiveId === id) renderResult(id, realUrl);
    }

    // Agrupa muchos eventos seguidos en una sola ejecución por frame
    let scheduled = false;
    function scheduleUpdate(): void {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        void updatePanel();
      });
    }

    // ---------- Inicio ----------
    const observer = new MutationObserver(scheduleUpdate);

    void (async () => {
      const stored = await browser.storage.local.get(AUTO_SAVE_KEY);
      autoSave = stored[AUTO_SAVE_KEY] === true;
      await refreshAuth();

      ctx.addEventListener(window, 'scroll', scheduleUpdate, { passive: true });
      observer.observe(document.body, {
        attributes: true,
        subtree: true,
        attributeFilter: ['class'],
      });
      scheduleUpdate();
    })();

    // Limpieza si la extensión se recarga o se desinstala
    ctx.onInvalidated(() => {
      observer.disconnect();
      panel.remove();
      style.remove();
    });
  },
});