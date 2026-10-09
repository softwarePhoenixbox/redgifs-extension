// Contrato de las funciones premium separables.
//
// - `premium/index.ts`  (repositorio privado / submódulo) implementa esta interfaz de verdad.
// - `stubs/premium.ts`  (público) la implementa lanzando "no incluido en la edición básica".
//
// El alias `@premium` apunta a una u otra según la edición (ver wxt.config.ts), así que el
// build `basic` no contiene el código premium. El background decide CUÁNDO llamarlas
// (después de autorizar la licencia); estas funciones solo hacen el trabajo.
import type { BulkLinkInput, ExportFormat } from './messages';

export interface PremiumDeps {
  isRedgifsUrl(url: string): boolean;
  idPattern: RegExp;
  startVideoDownload(
    id: string,
    url: string,
    metadata: { title?: string | null; author?: string | null; tags?: string[]; pageUrl?: string | null },
  ): Promise<{ downloadId?: number; metadataEmbedded: boolean; metadataWarning?: string }>;
}

export interface PremiumApi {
  exportLinks(format: ExportFormat, language: 'en' | 'es'): Promise<{ base64: string; filename: string; mime: string }>;
  saveBulk(links: BulkLinkInput[], deps: PremiumDeps): Promise<{ inserted: number; updated: number; total: number }>;
  downloadAll(deps: PremiumDeps): Promise<{ queued: number; failed: number; withoutMetadata: number }>;
}
