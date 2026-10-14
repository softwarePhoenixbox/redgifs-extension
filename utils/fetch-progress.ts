// Descarga un recurso a memoria reportando el avance (bytes recibidos / total).
// `total` es 0 cuando el servidor no manda Content-Length (progreso indeterminado).
// Lo usan el offscreen document de Chrome y el background (Firefox) para que el
// botón de descarga del content script pueda mostrar una barra de progreso real.

export type ProgressCallback = (loaded: number, total: number) => void;

const MIN_REPORT_INTERVAL_MS = 120;

export async function fetchBytesWithProgress(url: string, onProgress?: ProgressCallback): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`respuesta HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !onProgress) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.(bytes.byteLength, total || bytes.byteLength);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastReport = 0;
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    const now = Date.now();
    if (now - lastReport >= MIN_REPORT_INTERVAL_MS) {
      lastReport = now;
      onProgress(loaded, total);
    }
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress(loaded, total || loaded);
  return bytes;
}
