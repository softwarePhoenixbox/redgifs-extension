import { embedMp4Metadata } from '../../utils/mp4-metadata';
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
  if (message.type !== 'RG_OFFSCREEN_PREPARE_BLOB') return undefined;

  void (async (): Promise<RgResponse> => {
    const response = await fetch(message.url);
    if (!response.ok) throw new Error(`respuesta HTTP ${response.status}`);
    const source = new Uint8Array(await response.arrayBuffer());
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
