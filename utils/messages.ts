// Mensajes entre el content script (content.ts), el popup y el background
// (background.ts).

import type { LinkRow } from './links-db';

export type ExportFormat = 'sqlite' | 'db' | 'xlsx' | 'html';

// Un link tal como lo arma el content script para el guardado en lote
// (selección múltiple en grillas de tags/usuarios).
export interface BulkLinkInput {
  id: string;
  url: string;
  imageUrl?: string;
  pageUrl: string;
  title?: string;
  author?: string;
  tags?: string[];
  views?: string;
  likes?: string;
}

export type RgRequest =
  | { type: 'RG_DOWNLOAD'; id: string; url: string }
  | {
      type: 'RG_SAVE_LINK';
      id: string;
      url: string;
      imageUrl?: string;
      pageUrl: string;
      // Metadatos scrapeados de la página en el momento del guardado
      title?: string;
      author?: string;
      tags?: string[];
      views?: string;
      likes?: string;
    }
  | { type: 'RG_SAVE_BULK'; links: BulkLinkInput[] }
  | { type: 'RG_STATS' }
  | { type: 'RG_CHECK_LINK'; id: string }
  | { type: 'RG_EXPORT_DB'; format: ExportFormat }
  | { type: 'RG_IMPORT_DB'; base64: string }
  | { type: 'RG_LIST_LINKS' }
  | { type: 'RG_DELETE_LINK'; id: string }
  | { type: 'RG_DOWNLOAD_ALL' }
  // Popup -> content script: activa/desactiva el modo selección múltiple
  // en la grilla de thumbnails (perfiles, tags). No pasa por el background.
  | { type: 'RG_TOGGLE_GRID_SELECT'; enabled?: boolean };

export type RgResponse =
  | {
      ok: true;
      downloadId?: number; // RG_DOWNLOAD
      inserted?: boolean; // RG_SAVE_LINK (false = el link ya estaba guardado)
      total?: number; // RG_SAVE_LINK, RG_STATS, RG_IMPORT_DB y RG_DELETE_LINK
      exists?: boolean; // RG_CHECK_LINK
      base64?: string; // RG_EXPORT_DB
      filename?: string; // RG_EXPORT_DB
      mime?: string; // RG_EXPORT_DB
      imported?: number; // RG_IMPORT_DB (links nuevos)
      updated?: number; // RG_IMPORT_DB (links existentes actualizados)
      links?: LinkRow[]; // RG_LIST_LINKS
      queued?: number; // RG_DOWNLOAD_ALL (descargas iniciadas)
      failed?: number; // RG_DOWNLOAD_ALL (links inválidos o que fallaron)
      inserted_count?: number; // RG_SAVE_BULK (links nuevos)
      updated_count?: number; // RG_SAVE_BULK (links que ya existían y se actualizaron)
      enabled?: boolean; // RG_TOGGLE_GRID_SELECT (estado resultante del modo selección)
    }
  | { ok: false; error: string };