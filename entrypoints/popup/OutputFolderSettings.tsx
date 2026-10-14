import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SUBFOLDER,
  OUTPUT_AUTHORIZED_AT_KEY,
  OUTPUT_CUSTOM_NAME_KEY,
  OUTPUT_MODE_KEY,
  OUTPUT_SUBFOLDER_KEY,
  directoryPermission,
  loadDirectoryHandle,
  readOutputSettings,
  sanitizeSubfolder,
  supportsFolderPicker,
  type OutputMode,
} from '../../utils/output-folder';
import type { RgRequest, RgResponse } from '../../utils/messages';
import type { popupMessage } from '../../utils/popup-i18n';

type T = (key: Parameters<typeof popupMessage>[1], values?: Record<string, string | number>) => string;
// 'granted' solo si además una escritura de prueba real (hecha por el documento que guarda) funcionó.
type Permission = 'granted' | 'denied' | 'prompt' | 'none';

const smallButton = {
  background: '#3a3a3a', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 8px',
  cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
} as const;

// Ajustes de "dónde se guardan las descargas": carpeta del navegador o una carpeta elegida, + subcarpeta opcional.
export function OutputFolderSettings({ t }: { t: T }) {
  const canPick = supportsFolderPicker();
  const [mode, setMode] = useState<OutputMode>('browser');
  const [subfolder, setSubfolder] = useState(DEFAULT_SUBFOLDER);
  const [customName, setCustomName] = useState<string | null>(null);
  const [permission, setPermission] = useState<Permission>('none');

  const refresh = useCallback(async () => {
    const settings = await readOutputSettings();
    setMode(settings.mode === 'custom' && canPick ? 'custom' : 'browser');
    setSubfolder(settings.subfolder);
    setCustomName(settings.customName);
    try {
      const handle = canPick ? await loadDirectoryHandle() : null;
      if (!handle) {
        setPermission('none');
      } else if ((await directoryPermission(handle)) !== 'granted') {
        setPermission('prompt');
      } else {
        const res = (await browser.runtime.sendMessage({ type: 'RG_FOLDER_CHECK' } satisfies RgRequest).catch(() => undefined)) as RgResponse | undefined;
        setPermission(res?.ok ? 'granted' : 'prompt');
      }
    } catch {
      setPermission('none');
    }
  }, [canPick]);

  useEffect(() => {
    void refresh();
    // La pestaña "elegir carpeta" guarda en storage; el popup se entera aunque siga abierto.
    const onChanged = (changes: Record<string, unknown>) => {
      if (OUTPUT_MODE_KEY in changes || OUTPUT_CUSTOM_NAME_KEY in changes || OUTPUT_AUTHORIZED_AT_KEY in changes) void refresh();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [refresh]);

  async function updateMode(next: OutputMode) {
    setMode(next);
    await browser.storage.local.set({ [OUTPUT_MODE_KEY]: next });
  }

  async function commitSubfolder(raw: string) {
    const clean = sanitizeSubfolder(raw);
    setSubfolder(clean);
    // Se guarda también la cadena vacía: significa "sin subcarpeta" (distinto de "nunca configurado").
    await browser.storage.local.set({ [OUTPUT_SUBFOLDER_KEY]: clean });
  }

  const choose = () => void browser.tabs.create({ url: browser.runtime.getURL('/folder.html') });
  const radio = (value: OutputMode, label: string, disabled = false) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}>
      <input type="radio" name="rg-output-mode" checked={mode === value} disabled={disabled} onChange={() => void updateMode(value)} />
      {label}
    </label>
  );

  return (
    <div style={{ color: '#ccc', padding: '4px 0' }}>
      {/* Sin selector de carpetas (Firefox) solo existe la carpeta del navegador: no se muestran las opciones de destino, solo la subcarpeta. */}
      {canPick && (
        <>
          <strong style={{ display: 'block', fontWeight: 500, marginBottom: 2 }}>{t('outputFolder')}</strong>
          {radio('browser', t('outputBrowserDefault'))}
          {radio('custom', t('outputCustom'))}
        </>
      )}
      {mode === 'custom' && canPick && (
        <div style={{ margin: '4px 0 2px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={choose} style={smallButton}>{customName ? t('outputChange') : t('outputChoose')}</button>
            {customName && <span style={{ color: '#ddd', wordBreak: 'break-all' }}>{t('outputChosen', { name: customName })}</span>}
          </div>
          {!customName && <small style={{ display: 'block', color: '#e8c547', lineHeight: 1.3, marginTop: 3 }}>{t('outputNone')}</small>}
          {customName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ color: permission === 'granted' ? '#6ee7a0' : '#e8c547' }}>
                {permission === 'granted' ? t('outputReady') : t('outputNeedsPermission')}
              </span>
              {permission !== 'granted' && <button type="button" onClick={choose} style={smallButton}>{t('outputAuthorize')}</button>}
            </div>
          )}
          {customName && permission !== 'granted' && (
            <small style={{ display: 'block', color: '#999', lineHeight: 1.3, marginTop: 3 }}>{t('outputAuthorizeHint')}</small>
          )}
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 2px' }}>
        <span style={{ whiteSpace: 'nowrap' }}>{t('outputSubfolder')}</span>
        <input
          type="text"
          value={subfolder}
          placeholder={DEFAULT_SUBFOLDER}
          onChange={e => setSubfolder(e.target.value)}
          onBlur={e => void commitSubfolder(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          style={{ flex: 1, minWidth: 0, background: '#292929', color: '#eee', border: '1px solid #555', borderRadius: 4, padding: '3px 6px', fontFamily: 'inherit', fontSize: 12 }}
        />
      </label>
      <small style={{ display: 'block', color: '#999', lineHeight: 1.3, marginTop: 2 }}>{t('outputSubfolderHint')}</small>
    </div>
  );
}
