import { embedMp4Metadata } from '../../utils/mp4-metadata';
import type { RgRequest, RgResponse } from '../../utils/messages';

browser.runtime.onMessage.addListener(async (message: RgRequest): Promise<RgResponse | undefined> => {
  if (message.type === 'RG_OFFSCREEN_REVOKE_BLOB') {
    URL.revokeObjectURL(message.blob_url);
    return { ok: true };
  }
  if (message.type !== 'RG_OFFSCREEN_PREPARE_BLOB') return undefined;

  try {
    const response = await fetch(message.url);
    if (!response.ok) throw new Error(`respuesta HTTP ${response.status}`);
    const source = new Uint8Array(await response.arrayBuffer());
    const tagged = embedMp4Metadata(source, message.metadata);
    const taggedBuffer = new ArrayBuffer(tagged.byteLength);
    new Uint8Array(taggedBuffer).set(tagged);
    const blobUrl = URL.createObjectURL(new Blob([taggedBuffer], { type: 'video/mp4' }));
    return { ok: true, blob_url: blobUrl };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});
