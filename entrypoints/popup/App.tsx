import { useEffect, useMemo, useState } from 'react';
import type { LinkRow } from '../../utils/links-db';
import type { ExportFormat, GridSelectionItem, RgRequest, RgResponse } from '../../utils/messages';
import { DEFAULT_DOWNLOAD_OPTIONS, normalizeDownloadOptions, type DownloadChoice, type DownloadOptions } from '../../utils/download-options';
import { popupMessage, type PopupLanguage } from '../../utils/popup-i18n';

async function send(request: RgRequest, language: PopupLanguage): Promise<RgResponse> {
  try {
    const res = (await browser.runtime.sendMessage(request)) as RgResponse | undefined;
    return res ?? { ok: false, error: popupMessage(language, 'backgroundError') };
  } catch {
    return { ok: false, error: popupMessage(language, 'extensionError') };
  }
}

// A diferencia de send(), esto habla directo con el content script de la
// pestaña activa (no con el background). Se usa para el modo selección
// múltiple en grillas: solo tiene sentido en la pestaña que el usuario está
// mirando ahora mismo.
async function sendToActiveTab(request: RgRequest, language: PopupLanguage): Promise<RgResponse> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { ok: false, error: popupMessage(language, 'activeTabError') };
    const res = (await browser.tabs.sendMessage(tab.id, request)) as RgResponse | undefined;
    return res ?? { ok: false, error: popupMessage(language, 'pageError') };
  } catch {
    return { ok: false, error: popupMessage(language, 'redgifsError') };
  }
}

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const EXPORT_FORMATS: Array<[ExportFormat, string]> = [
  ['sqlite', '.sqlite'],
  ['db', '.db'],
  ['xlsx', 'Excel'],
  ['html', 'HTML'],
];

export default function App() {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [gridSelectMode, setGridSelectMode] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [selection, setSelection] = useState<GridSelectionItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelEnabled, setPanelEnabled] = useState(false);
  const [downloadActionEnabled, setDownloadActionEnabled] = useState(true);
  const [downloadOptions, setDownloadOptions] = useState<DownloadOptions>(DEFAULT_DOWNLOAD_OPTIONS);
  const [originalFilenameEnabled, setOriginalFilenameEnabled] = useState(true);
  const [language, setLanguage] = useState<PopupLanguage>('en');
  const t = (key: Parameters<typeof popupMessage>[1], values?: Record<string, string | number>) => popupMessage(language, key, values);

  useEffect(() => {
    void browser.storage.local.get(['rgPanelEnabled', 'rgDownloadActionEnabled', 'rgLanguage', 'rgDownloadQuality', 'rgDownloadOptions', 'rgOriginalFilename']).then(values => {
      setPanelEnabled(values.rgPanelEnabled === true);
      setDownloadActionEnabled(values.rgDownloadActionEnabled !== false);
      const savedLanguage: PopupLanguage = values.rgLanguage === 'es' ? 'es' : 'en';
      setLanguage(savedLanguage);
      setDownloadOptions(normalizeDownloadOptions(values.rgDownloadOptions, values.rgDownloadQuality));
      setOriginalFilenameEnabled(values.rgOriginalFilename !== false);
      document.documentElement.lang = savedLanguage;
    });
  }, []);

  async function updateLanguage(next: PopupLanguage) {
    setLanguage(next);
    document.documentElement.lang = next;
    await browser.storage.local.set({ rgLanguage: next });
  }

  async function updateSetting(key: 'rgPanelEnabled' | 'rgDownloadActionEnabled', enabled: boolean) {
    if (key === 'rgPanelEnabled') setPanelEnabled(enabled);
    else setDownloadActionEnabled(enabled);
    await browser.storage.local.set({ [key]: enabled });
  }

  async function updateDownloadOption(choice: DownloadChoice, enabled: boolean) {
    const next = { ...downloadOptions, [choice]: enabled };
    setDownloadOptions(next);
    await browser.storage.local.set({ rgDownloadOptions: next });
  }

  async function updateOriginalFilename(enabled: boolean) {
    setOriginalFilenameEnabled(enabled);
    await browser.storage.local.set({ rgOriginalFilename: enabled });
  }

  // El estado de este popup se reinicia cada vez que se cierra y se vuelve
  // a abrir, pero el modo selección vive en el content script de la
  // pestaña. Sin esto, el botón podía mostrar "desactivado" cuando en
  // realidad ya estaba activo, y el usuario no se enteraba de lo que ya
  // había tildado en la grilla.
  async function syncGridSelectState() {
    const res = await sendToActiveTab({ type: 'RG_GET_GRID_SELECT_STATE' }, language);
    if (res.ok) {
      setGridSelectMode(res.enabled ?? false);
      setSelectedCount(res.selected_count ?? 0);
      setPendingCount(res.pending_count ?? res.selected_count ?? 0);
      setSavedCount(res.saved_count ?? 0);
      if (res.enabled && (res.selected_count ?? 0) > 0) {
        const list = await sendToActiveTab({ type: 'RG_LIST_GRID_SELECTION' }, language);
        if (list.ok) setSelection(list.selection ?? []);
      } else {
        setSelection([]);
      }
    }
    // Si falla (pestaña sin redgifs.com abierta, por ejemplo), dejamos el
    // botón en su estado por defecto sin mostrar error: no es una acción
    // que el usuario haya pedido, es solo la sincronización inicial.
  }

  async function handleDeselectItem(id: string) {
    const res = await sendToActiveTab({ type: 'RG_DESELECT_GRID_ITEM', id }, language);
    if (res.ok) {
      setSelectedCount(res.selected_count ?? 0);
      setSelection(prev => prev.filter(item => item.id !== id));
    }
  }

  async function handleToggleGridSelect() {
    const next = !gridSelectMode;
    const res = await sendToActiveTab({ type: 'RG_TOGGLE_GRID_SELECT', enabled: next }, language);
    if (res.ok) {
      const enabled = res.enabled ?? next;
      setGridSelectMode(enabled);
      setSelectedCount(res.selected_count ?? 0);
      setPendingCount(res.pending_count ?? res.selected_count ?? 0);
      setSavedCount(res.saved_count ?? 0);
      if (enabled && (res.selected_count ?? 0) > 0) {
        const list = await sendToActiveTab({ type: 'RG_LIST_GRID_SELECTION' }, language);
        if (list.ok) setSelection(list.selection ?? []);
      } else {
        setSelection([]);
      }
      setStatus({
        text: enabled
          ? t('selectionStarted')
          : t('selectionStopped'),
        kind: 'ok',
      });
    } else {
      setStatus({ text: t('selectionError', { error: res.error }), kind: 'error' });
    }
  }

  async function loadLinks() {
    setBusy(true);
    const res = await send({ type: 'RG_LIST_LINKS' }, language);
    if (res.ok && res.links) setLinks([...res.links].reverse()); // más nuevos primero
    else setStatus({ text: res.ok ? t('listError') : res.error, kind: 'error' });
    setBusy(false);
  }

  useEffect(() => {
    void loadLinks();
    void syncGridSelectState();

    // El popup puede quedar abierto mientras el usuario interactúa con la
    // barra flotante de la página (guarda, limpia selección, activa/
    // desactiva, etc). Sin este polling, el botón y la lista se quedaban
    // mostrando el estado de cuando se abrió el popup, no el real.
    const interval = setInterval(() => void syncGridSelectState(), 2000);
    function onVisible() {
      if (document.visibilityState === 'visible') void syncGridSelectState();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [language]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return links;
    return links.filter(l =>
      [l.title, l.author, l.gifId, ...l.tags].some(v => v?.toLowerCase().includes(q)),
    );
  }, [links, query]);

  async function handleDelete(gifId: string) {
    setBusy(true);
    const res = await send({ type: 'RG_DELETE_LINK', id: gifId }, language);
    if (res.ok) {
      setLinks(prev => prev.filter(l => l.gifId !== gifId));
      setStatus({ text: t('deleted'), kind: 'ok' });
    } else {
      setStatus({ text: t('selectionError', { error: res.error }), kind: 'error' });
    }
    setBusy(false);
  }

  async function handleDownloadAll() {
    setBusy(true);
    setStatus({ text: t('downloadStarting', { count: links.length }), kind: 'ok' });
    const res = await send({ type: 'RG_DOWNLOAD_ALL' }, language);
    if (res.ok) {
      const metadataNote = res.without_metadata ? t('noMetadata', { count: res.without_metadata }) : '';
      setStatus({
        text: t('downloadResult', { queued: res.queued ?? 0, failed: res.failed ?? 0, metadata: metadataNote }),
        kind: res.without_metadata ? 'error' : 'ok',
      });
    } else {
      setStatus({ text: t('selectionError', { error: res.error }), kind: 'error' });
    }
    setBusy(false);
  }

  async function handleExport(format: ExportFormat) {
    setBusy(true);
    setStatus({ text: t('exporting'), kind: 'ok' });
    const res = await send({ type: 'RG_EXPORT_DB', format, language }, language);
    if (res.ok && res.base64 && res.filename) {
      saveBase64AsFile(res.base64, res.filename, res.mime ?? 'application/octet-stream');
      setStatus({ text: t('exported', { filename: res.filename }), kind: 'ok' });
    } else if (!res.ok) {
      setStatus({ text: t('selectionError', { error: res.error }), kind: 'error' });
    }
    setBusy(false);
  }

  async function handleImport(file: File) {
    setBusy(true);
    setStatus({ text: t('importing'), kind: 'ok' });
    try {
      const base64 = await fileToBase64(file);
      const res = await send({ type: 'RG_IMPORT_DB', base64 }, language);
      if (res.ok) {
        setStatus({ text: t('importResult', { imported: res.imported ?? 0, updated: res.updated ?? 0 }), kind: 'ok' });
        await loadLinks();
      } else {
        setStatus({ text: t('selectionError', { error: res.error }), kind: 'error' });
      }
    } catch {
      setStatus({ text: t('readFileError'), kind: 'error' });
    }
    setBusy(false);
  }

  return (
    <div style={{ width: 420, maxHeight: 560, display: 'flex', flexDirection: 'column', fontSize: 12 }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #333' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <strong style={{ color: '#00ff00', fontSize: 14 }}>🎯 {t('savedLinks')}</strong>
          <span style={{ marginLeft: 'auto', color: '#888' }}>{t('total', { count: links.length })}</span>
          <button
            type="button"
            onClick={() => setSettingsOpen(value => !value)}
            title={t('settings')}
            aria-label={t('settings')}
            aria-expanded={settingsOpen}
            style={{ background: settingsOpen ? '#454545' : 'transparent', border: '1px solid #555', borderRadius: 5, color: '#ddd', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '4px 7px' }}
          >
            ⚙
          </button>
        </div>
        {settingsOpen && (
          <div style={{ background: '#1c1c1c', border: '1px solid #444', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
            <strong style={{ display: 'block', color: '#ddd', marginBottom: 7 }}>{t('pageSettings')}</strong>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ccc', padding: '4px 0' }}>
              {t('language')}
              <select value={language} onChange={e => void updateLanguage(e.target.value as PopupLanguage)} style={{ marginLeft: 'auto', background: '#292929', color: '#eee', border: '1px solid #555', borderRadius: 4, padding: '3px 6px' }}>
                <option value="en">{t('languageEnglish')}</option>
                <option value="es">{t('languageSpanish')}</option>
              </select>
            </label>
            <div style={{ color: '#ccc', padding: '4px 0' }}>
              <strong style={{ display: 'block', fontWeight: 500, marginBottom: 2 }}>{t('downloadOptions')}</strong>
              {(['hd', 'sd', 'image'] as const).map(choice => (
                <label key={choice} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={downloadOptions[choice]} onChange={e => void updateDownloadOption(choice, e.target.checked)} />
                  {t(choice === 'hd' ? 'downloadHd' : choice === 'sd' ? 'downloadSd' : 'downloadImage')}
                </label>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={originalFilenameEnabled} onChange={e => void updateOriginalFilename(e.target.checked)} />
                {t('originalFilename')}
              </label>
              <small style={{ display: 'block', color: '#999', lineHeight: 1.3, marginTop: 2 }}>{t('downloadOptionsHint')}</small>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ccc', padding: '4px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={panelEnabled} onChange={e => void updateSetting('rgPanelEnabled', e.target.checked)} />
              {t('showPanel')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ccc', padding: '4px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={downloadActionEnabled} onChange={e => void updateSetting('rgDownloadActionEnabled', e.target.checked)} />
              {t('showDownloadAction')}
            </label>
          </div>
        )}
        <button
          onClick={() => void handleToggleGridSelect()}
          style={{
            width: '100%',
            marginBottom: 8,
            background: gridSelectMode ? '#00ff00' : '#3a3a3a',
            color: gridSelectMode ? '#000' : '#ddd',
            border: '1px solid ' + (gridSelectMode ? '#00ff00' : '#555'),
            borderRadius: 6,
            padding: '7px 0',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 11,
          }}
        >
          {gridSelectMode
              ? savedCount > 0
              ? t('selectPendingSaved', { pending: pendingCount, saved: savedCount })
              : t('selectActive', { count: pendingCount })
            : t('selectPage')}
        </button>
        {gridSelectMode && selection.length > 0 && (
          <div
            style={{
              maxHeight: 130,
              overflowY: 'auto',
              background: '#1c1c1c',
              border: '1px solid #444',
              borderRadius: 6,
              marginBottom: 8,
              padding: '4px 6px',
            }}
          >
            {selection.map(item => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 2px',
                  borderBottom: '1px solid #262626',
                }}
              >
                <span style={{ color: item.saved ? '#2f9bff' : '#00ff00' }}>{item.saved ? '💾' : '✓'}</span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: item.saved ? '#888' : '#ddd',
                  }}
                  title={item.title ?? item.id}
                >
                  {item.title ?? item.id}
                </span>
                <button
                  onClick={() => void handleDeselectItem(item.id)}
                  title={t('deselect')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ff8b8b',
                    cursor: 'pointer',
                    fontSize: 12,
                    padding: '0 4px',
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('search')}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: '#1c1c1c',
            color: '#eee',
            border: '1px solid #444',
            borderRadius: 6,
            padding: '6px 8px',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
        {filtered.length === 0 && (
          <p style={{ color: '#888', textAlign: 'center', marginTop: 24 }}>
            {links.length === 0 ? t('empty') : t('noResults')}
          </p>
        )}
        {filtered.map(link => (
          <div
            key={link.gifId}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: '8px 6px',
              borderBottom: '1px solid #262626',
            }}
          >
            {link.imageUrl && (
              <img
                src={link.imageUrl}
                alt={link.title ?? link.gifId}
                loading="lazy"
                style={{
                  width: '100%',
                  maxHeight: 160,
                  objectFit: 'cover',
                  borderRadius: 6,
                  marginBottom: 4,
                  background: '#1c1c1c',
                }}
                onError={e => {
                  // Si la URL firmada venció o falló, ocultamos el <img> roto
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontWeight: 'bold',
                  color: '#ddd',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
                title={link.title ?? link.gifId}
              >
                {link.title ?? link.gifId}
              </span>
              <span style={{ color: '#bbb', flexShrink: 0 }}>
                👁 {link.views ?? '—'} ❤ {link.likes ?? '—'}
              </span>
            </div>
            <div style={{ color: '#888' }}>
              {link.author ? `@${link.author} · ` : ''}
              {new Date(link.createdAt).toLocaleDateString(language === 'es' ? 'es' : 'en')}
            </div>
            {link.tags.length > 0 && (
              <div style={{ color: '#9fd3ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {link.tags.join(' ')}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: 1,
                  textAlign: 'center',
                  background: '#00ff00',
                  color: '#000',
                  borderRadius: 4,
                  padding: '4px 0',
                  fontWeight: 'bold',
                  textDecoration: 'none',
                }}
              >
                {t('view')}
              </a>
              {link.pageUrl && (
                <a
                  href={link.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    background: '#2f6bff',
                    color: '#fff',
                    borderRadius: 4,
                    padding: '4px 0',
                    textDecoration: 'none',
                  }}
                >
                  {t('page')}
                </a>
              )}
              <button
                onClick={() => void handleDelete(link.gifId)}
                disabled={busy}
                style={{
                  flex: 1,
                  background: '#e5484d',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 0',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('delete')}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '8px 12px', borderTop: '1px solid #333', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {status && (
          <div style={{ color: status.kind === 'ok' ? '#7ee787' : '#ff8b8b', fontSize: 11 }}>{status.text}</div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => void loadLinks()}
            disabled={busy}
            style={{ flex: 1, background: '#3a3a3a', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '6px 0', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {t('refresh')}
          </button>
          <button
            onClick={() => void handleDownloadAll()}
            disabled={busy || links.length === 0}
            style={{ flex: 1, background: '#2f6bff', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 0', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {t('downloadAll')}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {EXPORT_FORMATS.map(([format, label]) => (
            <button
              key={format}
              onClick={() => void handleExport(format)}
              disabled={busy}
              style={{ flex: 1, background: '#3a3a3a', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {label}
            </button>
          ))}
        </div>
        <label
          style={{
            display: 'block',
            textAlign: 'center',
            background: '#3a3a3a',
            color: '#9fd3ff',
            border: '1px solid #555',
            borderRadius: 4,
            padding: '6px 0',
            fontSize: 10,
            cursor: 'pointer',
          }}
        >
          {t('importDb')}
          <input
            type="file"
            accept=".sqlite,.db"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}
