// Descarga un recurso a memoria reportando el avance (bytes recibidos / total).
// `total` es 0 cuando el servidor no manda Content-Length (progreso indeterminado).
// Lo usan el offscreen document de Chrome y el background (Firefox) para que el
// botón de descarga del content script pueda mostrar una barra de progreso real.

export type ProgressCallback = (loaded: number, total: number) => void;

const MIN_REPORT_INTERVAL_MS = 120;

// Descarga por tramos en paralelo (Range). Una sola conexión suele quedar muy por debajo del ancho de banda
// disponible (el CDN limita por conexión); con varias se aprovecha todo. Si el servidor no soporta Range o algo
// falla, se vuelve a la descarga de una sola conexión de siempre.
const PARALLEL_CONNECTIONS = 8;
const MIN_PART_BYTES = 1024 * 1024;

async function fetchParallel(url: string, onProgress?: ProgressCallback): Promise<Uint8Array | null> {
  let total = 0;
  try {
    const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    await probe.body?.cancel().catch(() => undefined);
    if (probe.status !== 206) return null;
    total = Number(/\/(\d+)\s*$/.exec(probe.headers.get('content-range') ?? '')?.[1]) || 0;
  } catch {
    return null;
  }
  if (total < MIN_PART_BYTES * 2) return null;

  const parts = Math.min(PARALLEL_CONNECTIONS, Math.ceil(total / MIN_PART_BYTES));
  const size = Math.ceil(total / parts);
  const bytes = new Uint8Array(total);
  let loaded = 0;
  let lastReport = 0;
  onProgress?.(0, total);
  const controller = new AbortController();

  async function fetchPart(index: number): Promise<void> {
    const start = index * size;
    const end = Math.min(start + size, total) - 1;
    const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal });
    if (response.status !== 206 || !response.body) throw new Error('Range no soportado');
    const reader = response.body.getReader();
    let offset = start;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (offset + value.byteLength > end + 1) throw new Error('Tramo más largo de lo esperado');
      bytes.set(value, offset);
      offset += value.byteLength;
      loaded += value.byteLength;
      const now = Date.now();
      if (onProgress && now - lastReport >= MIN_REPORT_INTERVAL_MS) {
        lastReport = now;
        onProgress(loaded, total);
      }
    }
    if (offset !== end + 1) throw new Error('Tramo incompleto');
  }

  try {
    await Promise.all(Array.from({ length: parts }, (_, index) => fetchPart(index)));
  } catch {
    controller.abort();
    return null;
  }
  onProgress?.(total, total);
  return bytes;
}

export async function fetchBytesWithProgress(url: string, onProgress?: ProgressCallback): Promise<Uint8Array> {
  const parallel = await fetchParallel(url, onProgress);
  if (parallel) return parallel;
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
