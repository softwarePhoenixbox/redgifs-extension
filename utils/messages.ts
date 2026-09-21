// Mensajes entre el content script (content.ts) y el background (background.ts).

export type RgRequest =
  | { type: 'RG_DOWNLOAD'; id: string; url: string }
  | { type: 'RG_SAVE_LINK'; id: string; url: string; pageUrl: string }
  | { type: 'RG_STATS' }
  | { type: 'RG_EXPORT_DB' };

export type RgResponse =
  | {
      ok: true;
      downloadId?: number; // RG_DOWNLOAD
      inserted?: boolean; // RG_SAVE_LINK (false = el link ya estaba guardado)
      total?: number; // RG_SAVE_LINK y RG_STATS
      base64?: string; // RG_EXPORT_DB
    }
  | { ok: false; error: string };