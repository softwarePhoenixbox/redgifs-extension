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

// Un item tildado en la grilla, tal como lo muestra el popup mientras
// todavía no se guardó (RG_LIST_GRID_SELECTION).
export interface GridSelectionItem {
  id: string;
  title: string | null;
  saved: boolean; // true = ya se guardó en esta sesión (marcado en azul en la página)
}

export type RgRequest =
  | { type: 'RG_OFFSCREEN_PREPARE_BLOB'; url: string; metadata: { title?: string | null; author?: string | null; tags?: string[]; pageUrl?: string | null } }
  | { type: 'RG_OFFSCREEN_PREPARE_IMAGE_BLOB'; base64: string }
  | { type: 'RG_OFFSCREEN_REVOKE_BLOB'; blob_url: string }
  | { type: 'RG_DOWNLOAD_FRAME'; id: string; base64: string; filename?: string; useOriginalFilename?: boolean }
  | { type: 'RG_REDDIT_MENU_OPEN'; requestId: string; gifId: string; choices: Array<'hd' | 'sd' | 'image' | 'frame'> }
  | { type: 'RG_REDDIT_MENU_SHOW'; requestId: string; gifId: string; choices: Array<'hd' | 'sd' | 'image' | 'frame'> }
  | { type: 'RG_REDDIT_MENU_SELECTED'; requestId: string; choice: 'hd' | 'sd' | 'image' | 'frame' }
  | { type: 'RG_REDDIT_MENU_CHOOSE'; requestId: string; choice: 'hd' | 'sd' | 'image' | 'frame' }
  | { type: 'RG_RESOLVE_GIF'; id: string }
  | {
      type: 'RG_DOWNLOAD';
      id: string;
      url: string;
      title?: string;
      author?: string;
      tags?: string[];
      pageUrl?: string;
      filename?: string;
      useOriginalFilename?: boolean;
      quality?: 'hd' | 'sd' | 'image';
    }
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
  | { type: 'RG_EXPORT_DB'; format: ExportFormat; language?: 'en' | 'es' }
  | { type: 'RG_IMPORT_DB'; base64: string }
  | { type: 'RG_LIST_LINKS' }
  | { type: 'RG_DELETE_LINK'; id: string }
  | { type: 'RG_DOWNLOAD_ALL' }
  // Popup -> content script: activa/desactiva el modo selección múltiple
  // en la grilla de thumbnails (perfiles, tags). No pasa por el background.
  | { type: 'RG_TOGGLE_GRID_SELECT'; enabled?: boolean }
  // Popup -> content script: solo consulta el estado actual (modo activo y
  // cuántos hay seleccionados), sin cambiar nada. Se usa al abrir el popup,
  // porque su estado de React se reinicia cada vez que se cierra y el
  // content script es la única fuente de verdad real.
  | { type: 'RG_GET_GRID_SELECT_STATE' }
  // Popup -> content script: pide el detalle (id + título si hay) de lo
  // seleccionado ahora mismo en la grilla, para mostrarlo en el popup sin
  // que el usuario tenga que volver a la página a revisar qué tildó.
  | { type: 'RG_LIST_GRID_SELECTION' }
  // Popup -> content script: destilda un item puntual sin desactivar el
  // modo selección ni tocar el resto.
  | { type: 'RG_DESELECT_GRID_ITEM'; id: string };

export type RgResponse =
  | {
      ok: true;
      gif?: {
        videoUrl: string;
        hdVideoUrl?: string;
        sdVideoUrl?: string;
        imageUrl: string;
        metadata?: { title: string | null; author: string | null; tags: string[] };
      }; // RG_RESOLVE_GIF
      not_found?: boolean; // RG_RESOLVE_GIF
      rate_limited?: boolean; // RG_RESOLVE_GIF
      blob_url?: string; // Offscreen Chrome helper
      downloadId?: number; // RG_DOWNLOAD
      metadata_embedded?: boolean; // RG_DOWNLOAD
      metadata_warning?: string; // RG_DOWNLOAD
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
      without_metadata?: number; // RG_DOWNLOAD_ALL (descargados sin metadatos incrustados)
      inserted_count?: number; // RG_SAVE_BULK (links nuevos)
      updated_count?: number; // RG_SAVE_BULK (links que ya existían y se actualizaron)
      enabled?: boolean; // RG_TOGGLE_GRID_SELECT / RG_GET_GRID_SELECT_STATE (estado del modo selección)
      selected_count?: number; // RG_GET_GRID_SELECT_STATE (total marcados: pendientes + guardados)
      pending_count?: number; // RG_GET_GRID_SELECT_STATE (marcados que todavía no se guardaron)
      saved_count?: number; // RG_GET_GRID_SELECT_STATE (marcados que ya se guardaron en esta sesión)
      selection?: GridSelectionItem[]; // RG_LIST_GRID_SELECTION
    }
  | { ok: false; error: string };
