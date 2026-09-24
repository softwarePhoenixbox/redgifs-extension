export type PopupLanguage = 'en' | 'es';

const messages = {
  en: {
    savedLinks: 'Saved links', total: '{count} total', settings: 'Settings', pageSettings: 'Page settings', language: 'Language',
    showPanel: 'Show “On-screen video” panel', showDownloadAction: 'Show download icon beside video actions',
    selectPage: '▣ Select on page (tags/users)', selectActive: '▣ Selection ACTIVE ({count}) — click to stop',
    selectPendingSaved: '▣ {pending} pending · {saved} saved 💾', selectionStarted: '🔲 Selection enabled: click GIFs on the page, then save them here',
    selectionStopped: 'Selection disabled', deselect: 'Remove from selection', search: 'Search by title, author, or tag…',
    empty: 'You have not saved any links yet.', noResults: 'No results for this search.', view: '▶ View', page: 'Page', delete: '🗑 Delete',
    deleted: '✔ Link deleted', refresh: '↻ Refresh', downloadAll: '⬇ Download all', importing: 'Importing and merging…',
    importDb: '📥 Import DB (merge, no duplicates)', exporting: 'Exporting…', exported: '✔ Exported: {filename}',
    importResult: '✔ {imported} new, {updated} updated', importFailed: '✖ Could not read the file',
    downloadStarting: 'Downloading {count} links…', downloadResult: '✔ {queued} queued, {failed} failed{metadata}',
    noMetadata: ', {count} without metadata', selectionError: '✖ {error}', backgroundError: 'No response from the background',
    extensionError: 'Could not contact the extension', activeTabError: 'No active tab found', pageError: 'No response from the page',
    redgifsError: 'Open a redgifs.com page to use this', listError: 'Could not read the list', readFileError: '✖ Could not read the file',
    selectRemove: 'Remove from selection', saved: 'saved', pending: 'pending', languageEnglish: 'English', languageSpanish: 'Spanish',
  },
  es: {
    savedLinks: 'Links guardados', total: '{count} total', settings: 'Ajustes', pageSettings: 'Ajustes de la página', language: 'Idioma',
    showPanel: 'Mostrar “Video en Pantalla”', showDownloadAction: 'Mostrar icono de descarga junto a las acciones del video',
    selectPage: '▣ Seleccionar en la página (tags/usuarios)', selectActive: '▣ Selección ACTIVA ({count}) — toca para desactivar',
    selectPendingSaved: '▣ {pending} pendientes · {saved} guardados 💾', selectionStarted: '🔲 Selección activada: toca los GIFs en la página y guárdalos desde aquí',
    selectionStopped: 'Selección desactivada', deselect: 'Quitar de la selección', search: 'Buscar por título, autor o tag…',
    empty: 'Todavía no guardaste ningún link.', noResults: 'Sin resultados para esa búsqueda.', view: '▶ Ver', page: 'Página', delete: '🗑 Borrar',
    deleted: '✔ Link borrado', refresh: '↻ Actualizar', downloadAll: '⬇ Descargar todo', importing: 'Importando y fusionando…',
    importDb: '📥 Importar DB (fusionar, sin duplicar)', exporting: 'Exportando…', exported: '✔ Exportado: {filename}',
    importResult: '✔ {imported} nuevos, {updated} actualizados', importFailed: '✖ No se pudo leer el archivo',
    downloadStarting: 'Descargando {count} links…', downloadResult: '✔ {queued} en cola, {failed} fallaron{metadata}',
    noMetadata: ', {count} sin metadatos', selectionError: '✖ {error}', backgroundError: 'Sin respuesta del background',
    extensionError: 'No se pudo contactar con la extensión', activeTabError: 'No se encontró la pestaña activa', pageError: 'Sin respuesta de la página',
    redgifsError: 'Abrí una página de redgifs.com para usar esto', listError: 'No se pudo leer la lista', readFileError: '✖ No se pudo leer el archivo',
    selectRemove: 'Quitar de la selección', saved: 'guardados', pending: 'pendientes', languageEnglish: 'Inglés', languageSpanish: 'Español',
  },
} as const;

type MessageKey = keyof typeof messages.en;

export function popupMessage(language: PopupLanguage, key: MessageKey, values: Record<string, string | number> = {}): string {
  return messages[language][key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}
