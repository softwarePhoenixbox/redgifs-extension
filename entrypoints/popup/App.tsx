import { useEffect, useMemo, useState } from 'react';
import type { LinkRow } from '../../utils/links-db';
import type { ExportFormat, GridSelectionItem, RgRequest, RgResponse } from '../../utils/messages';

async function send(request: RgRequest): Promise<RgResponse> {
  try {
    const res = (await browser.runtime.sendMessage(request)) as RgResponse | undefined;
    return res ?? { ok: false, error: 'Sin respuesta del background' };
  } catch {
    return { ok: false, error: 'No se pudo contactar con la extensión' };
  }
}

// A diferencia de send(), esto habla directo con el content script de la
// pestaña activa (no con el background). Se usa para el modo selección
// múltiple en grillas: solo tiene sentido en la pestaña que el usuario está
// mirando ahora mismo.
async function sendToActiveTab(request: RgRequest): Promise<RgResponse> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { ok: false, error: 'No se encontró la pestaña activa' };
    const res = (await browser.tabs.sendMessage(tab.id, request)) as RgResponse | undefined;
    return res ?? { ok: false, error: 'Sin respuesta de la página' };
  } catch {
    return { ok: false, error: 'Abrí una página de redgifs.com para usar esto' };
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

  // El estado de este popup se reinicia cada vez que se cierra y se vuelve
  // a abrir, pero el modo selección vive en el content script de la
  // pestaña. Sin esto, el botón podía mostrar "desactivado" cuando en
  // realidad ya estaba activo, y el usuario no se enteraba de lo que ya
  // había tildado en la grilla.
  async function syncGridSelectState() {
    const res = await sendToActiveTab({ type: 'RG_GET_GRID_SELECT_STATE' });
    if (res.ok) {
      setGridSelectMode(res.enabled ?? false);
      setSelectedCount(res.selected_count ?? 0);
      setPendingCount(res.pending_count ?? res.selected_count ?? 0);
      setSavedCount(res.saved_count ?? 0);
      if (res.enabled && (res.selected_count ?? 0) > 0) {
        const list = await sendToActiveTab({ type: 'RG_LIST_GRID_SELECTION' });
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
    const res = await sendToActiveTab({ type: 'RG_DESELECT_GRID_ITEM', id });
    if (res.ok) {
      setSelectedCount(res.selected_count ?? 0);
      setSelection(prev => prev.filter(item => item.id !== id));
    }
  }

  async function handleToggleGridSelect() {
    const next = !gridSelectMode;
    const res = await sendToActiveTab({ type: 'RG_TOGGLE_GRID_SELECT', enabled: next });
    if (res.ok) {
      const enabled = res.enabled ?? next;
      setGridSelectMode(enabled);
      setSelectedCount(res.selected_count ?? 0);
      setPendingCount(res.pending_count ?? res.selected_count ?? 0);
      setSavedCount(res.saved_count ?? 0);
      if (enabled && (res.selected_count ?? 0) > 0) {
        const list = await sendToActiveTab({ type: 'RG_LIST_GRID_SELECTION' });
        if (list.ok) setSelection(list.selection ?? []);
      } else {
        setSelection([]);
      }
      setStatus({
        text: enabled
          ? '🔲 Selección activada: tocá los gifs en la página y guardalos desde ahí'
          : 'Selección desactivada',
        kind: 'ok',
      });
    } else {
      setStatus({ text: `✖ ${res.error}`, kind: 'error' });
    }
  }

  async function loadLinks() {
    setBusy(true);
    const res = await send({ type: 'RG_LIST_LINKS' });
    if (res.ok && res.links) setLinks([...res.links].reverse()); // más nuevos primero
    else setStatus({ text: res.ok ? 'No se pudo leer la lista' : res.error, kind: 'error' });
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
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return links;
    return links.filter(l =>
      [l.title, l.author, l.gifId, ...l.tags].some(v => v?.toLowerCase().includes(q)),
    );
  }, [links, query]);

  async function handleDelete(gifId: string) {
    setBusy(true);
    const res = await send({ type: 'RG_DELETE_LINK', id: gifId });
    if (res.ok) {
      setLinks(prev => prev.filter(l => l.gifId !== gifId));
      setStatus({ text: '✔ Link borrado', kind: 'ok' });
    } else {
      setStatus({ text: `✖ ${res.error}`, kind: 'error' });
    }
    setBusy(false);
  }

  async function handleDownloadAll() {
    setBusy(true);
    setStatus({ text: `Descargando ${links.length} links...`, kind: 'ok' });
    const res = await send({ type: 'RG_DOWNLOAD_ALL' });
    if (res.ok) {
      setStatus({ text: `✔ ${res.queued ?? 0} en cola, ${res.failed ?? 0} fallaron`, kind: 'ok' });
    } else {
      setStatus({ text: `✖ ${res.error}`, kind: 'error' });
    }
    setBusy(false);
  }

  async function handleExport(format: ExportFormat) {
    setBusy(true);
    setStatus({ text: 'Exportando...', kind: 'ok' });
    const res = await send({ type: 'RG_EXPORT_DB', format });
    if (res.ok && res.base64 && res.filename) {
      saveBase64AsFile(res.base64, res.filename, res.mime ?? 'application/octet-stream');
      setStatus({ text: `✔ Exportado: ${res.filename}`, kind: 'ok' });
    } else if (!res.ok) {
      setStatus({ text: `✖ ${res.error}`, kind: 'error' });
    }
    setBusy(false);
  }

  async function handleImport(file: File) {
    setBusy(true);
    setStatus({ text: 'Importando y fusionando...', kind: 'ok' });
    try {
      const base64 = await fileToBase64(file);
      const res = await send({ type: 'RG_IMPORT_DB', base64 });
      if (res.ok) {
        setStatus({ text: `✔ ${res.imported ?? 0} nuevos, ${res.updated ?? 0} actualizados`, kind: 'ok' });
        await loadLinks();
      } else {
        setStatus({ text: `✖ ${res.error}`, kind: 'error' });
      }
    } catch {
      setStatus({ text: '✖ No se pudo leer el archivo', kind: 'error' });
    }
    setBusy(false);
  }

  return (
    <div style={{ width: 420, maxHeight: 560, display: 'flex', flexDirection: 'column', fontSize: 12 }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #333' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <strong style={{ color: '#00ff00', fontSize: 14 }}>🎯 Links guardados</strong>
          <span style={{ marginLeft: 'auto', color: '#888' }}>{links.length} total</span>
        </div>
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
              ? `🔲 ${pendingCount} pendientes · ${savedCount} guardados 💾`
              : `🔲 Selección ACTIVA (${pendingCount}) — tocá para desactivar`
            : '🔲 Seleccionar en la página (tags/usuarios)'}
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
                  title="Quitar de la selección"
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
          placeholder="Buscar por título, autor o tag..."
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
            {links.length === 0 ? 'Todavía no guardaste ningún link.' : 'Sin resultados para esa búsqueda.'}
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
              {new Date(link.createdAt).toLocaleDateString()}
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
                ▶ Ver
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
                  Página
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
                🗑 Borrar
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
            ↻ Actualizar
          </button>
          <button
            onClick={() => void handleDownloadAll()}
            disabled={busy || links.length === 0}
            style={{ flex: 1, background: '#2f6bff', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 0', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            ⬇ Descargar todo
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
          📥 Importar DB (fusionar, sin duplicar)
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