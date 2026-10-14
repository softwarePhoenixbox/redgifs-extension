// Página de una pestaña (no el popup) para elegir/autorizar la carpeta de descargas: el selector nativo cierra
// el popup al abrirse, y Chrome solo ofrece «Permitir en cada visita» cuando el permiso se pide desde una pestaña.
import { popupMessage, type PopupLanguage } from '../../utils/popup-i18n';
import {
  OUTPUT_AUTHORIZED_AT_KEY,
  OUTPUT_CUSTOM_NAME_KEY,
  OUTPUT_MODE_KEY,
  directoryPermission,
  loadDirectoryHandle,
  saveDirectoryHandle,
  supportsFolderPicker,
} from '../../utils/output-folder';
import type { RgRequest, RgResponse } from '../../utils/messages';

const title = document.getElementById('title') as HTMLElement;
const text = document.getElementById('text') as HTMLElement;
const current = document.getElementById('current') as HTMLElement;
const pick = document.getElementById('pick') as HTMLButtonElement;
const authorize = document.getElementById('authorize') as HTMLButtonElement;
const hint = document.getElementById('hint') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;

function setStatus(message: string, kind: 'ok' | 'error' | ''): void {
  status.textContent = message;
  status.className = kind;
}

async function main(): Promise<void> {
  const stored = await browser.storage.local.get('rgLanguage');
  const language: PopupLanguage = stored.rgLanguage === 'es' ? 'es' : 'en';
  const t = (key: Parameters<typeof popupMessage>[1], values?: Record<string, string | number>) => popupMessage(language, key, values);
  document.documentElement.lang = language;
  document.title = t('folderPageTitle');
  title.textContent = t('folderPageTitle');
  text.textContent = t('folderPageText');
  pick.textContent = t('folderPagePick');
  authorize.textContent = t('folderPageAuthorize');
  hint.textContent = t('folderPageHint');

  if (!supportsFolderPicker()) {
    pick.disabled = true;
    setStatus(t('folderPageUnsupported'), 'error');
    return;
  }

  // Verificación real: la hace el documento que escribe las descargas, no esta página.
  async function verify(name: string): Promise<void> {
    let res: RgResponse | undefined;
    try {
      res = (await browser.runtime.sendMessage({ type: 'RG_FOLDER_CHECK' } satisfies RgRequest)) as RgResponse | undefined;
    } catch (error) {
      res = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (res?.ok) setStatus(t('folderPageVerified', { name }), 'ok');
    else setStatus(t('folderPageNotWritable', { error: res && !res.ok ? res.error : '—' }), 'error');
    await browser.storage.local.set({ [OUTPUT_AUTHORIZED_AT_KEY]: Date.now() });
  }

  async function showCurrent(): Promise<void> {
    const handle = await loadDirectoryHandle().catch(() => null);
    if (!handle) {
      current.textContent = '';
      authorize.hidden = true;
      return;
    }
    current.textContent = t('folderPageCurrent', { name: handle.name });
    authorize.hidden = false;
  }
  await showCurrent();

  pick.addEventListener('click', async () => {
    pick.disabled = true;
    authorize.disabled = true;
    try {
      const picker = (globalThis as unknown as { showDirectoryPicker(options: { id: string; mode: 'readwrite'; startIn?: string }): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      const handle = await picker.call(globalThis, { id: 'rg-output', mode: 'readwrite', startIn: 'downloads' });
      if ((await directoryPermission(handle, true)) !== 'granted') throw new Error('permission denied');
      await saveDirectoryHandle(handle);
      await browser.storage.local.set({ [OUTPUT_CUSTOM_NAME_KEY]: handle.name, [OUTPUT_MODE_KEY]: 'custom' });
      await showCurrent();
      await verify(handle.name);
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') setStatus('', '');
      else setStatus(t('folderPageError', { error: error instanceof Error ? error.message : String(error) }), 'error');
    } finally {
      pick.disabled = false;
      authorize.disabled = false;
    }
  });

  authorize.addEventListener('click', async () => {
    authorize.disabled = true;
    try {
      const handle = await loadDirectoryHandle();
      if (!handle) return;
      if ((await directoryPermission(handle, true)) !== 'granted') throw new Error('permission denied');
      await verify(handle.name);
    } catch (error) {
      setStatus(t('folderPageError', { error: error instanceof Error ? error.message : String(error) }), 'error');
    } finally {
      authorize.disabled = false;
    }
  });
}

void main();
