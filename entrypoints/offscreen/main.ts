import { HAS_PREMIUM } from '../../utils/edition';
import { embedMp4Metadata } from '../../utils/mp4-metadata';
import { fetchBytesWithProgress } from '../../utils/fetch-progress';
import { checkChosenFolderWritable, getReadyRoot, writeToChosenFolder } from '../../utils/output-folder';
import type { RgRequest, RgResponse } from '../../utils/messages';

browser.runtime.onMessage.addListener((message: RgRequest, _sender, sendResponse) => {
  if (message.type === 'RG_OFFSCREEN_REVOKE_BLOB') {
    URL.revokeObjectURL(message.blob_url);
    sendResponse({ ok: true } satisfies RgResponse);
    return false;
  }
  // Important: runtime.sendMessage broadcasts to every extension page.
  // Ignore unrelated messages synchronously so this offscreen document
  // cannot race the background listener with an empty Promise response.
  if (HAS_PREMIUM && message.type === 'RG_OFFSCREEN_PREPARE_IMAGE_BLOB') {
    try {
      const bytes = Uint8Array.from(atob(message.base64), character => character.charCodeAt(0));
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      sendResponse({ ok: true, blob_url: blobUrl } satisfies RgResponse);
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies RgResponse);
    }
    return false;
  }
  if (message.type === 'RG_OFFSCREEN_CHECK_FOLDER') {
    checkChosenFolderWritable()
      .then(() => sendResponse({ ok: true } satisfies RgResponse))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies RgResponse));
    return true;
  }
  if (message.type === 'RG_OFFSCREEN_SAVE') {
    void (async (): Promise<RgResponse> => {
      const { progressId } = message;
      await getReadyRoot(); // si no hay carpeta o permiso, falla ya, sin bajar el archivo dos veces
      let bytes: Uint8Array;
      if ('base64' in message.source) {
        bytes = Uint8Array.from(atob(message.source.base64), character => character.charCodeAt(0));
      } else {
        bytes = await fetchBytesWithProgress(message.source.url, progressId
          ? (loaded, total) => {
              void browser.runtime.sendMessage({ type: 'RG_DOWNLOAD_PROGRESS', progressId, loaded, total } satisfies RgRequest).catch(() => undefined);
            }
          : undefined);
      }
      let embedded = false;
      let warning: string | undefined;
      if (message.metadata && /\.(?:mp4|m4v)$/i.test(message.name)) {
        try {
          bytes = embedMp4Metadata(bytes, message.metadata);
          embedded = true;
        } catch (error) {
          warning = `No se pudieron incrustar los metadatos (${error instanceof Error ? error.message : String(error)}); se guardó el video sin metadatos.`;
        }
      }
      const savedName = await writeToChosenFolder(message.subfolder, message.name, bytes);
      return { ok: true, saved_name: savedName, metadata_embedded: embedded, metadata_warning: warning };
    })()
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies RgResponse);
      });
    return true;
  }
  if (message.type !== 'RG_OFFSCREEN_PREPARE_BLOB') return undefined;

  void (async (): Promise<RgResponse> => {
    const { progressId } = message;
    const source = await fetchBytesWithProgress(message.url, progressId
      ? (loaded, total) => {
          // El background reenvía este avance al tab que pidió la descarga.
          void browser.runtime.sendMessage({ type: 'RG_DOWNLOAD_PROGRESS', progressId, loaded, total } satisfies RgRequest).catch(() => undefined);
        }
      : undefined);
    const tagged = embedMp4Metadata(source, message.metadata);
    const taggedBuffer = new ArrayBuffer(tagged.byteLength);
    new Uint8Array(taggedBuffer).set(tagged);
    const blobUrl = URL.createObjectURL(new Blob([taggedBuffer], { type: 'video/mp4' }));
    return { ok: true, blob_url: blobUrl };
  })()
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RgResponse);
    });
  return true;
});
