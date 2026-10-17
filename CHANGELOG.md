# Changelog

## [0.2.0](https://github.com/softwarePhoenixbox/redgifs-extension/compare/redgifs-extension-v0.1.55...redgifs-extension-v0.2.0) (2026-10-14)


### Features

* add donwload button downlaod % ([c78c3fa](https://github.com/softwarePhoenixbox/redgifs-extension/commit/c78c3fafc565e5d4c25fdde27c97dbbb237937fb))


### Bug Fixes

* fixed use  vulneravitlies ([318c3c9](https://github.com/softwarePhoenixbox/redgifs-extension/commit/318c3c9932429e959d57b05375e79ce1d2d617a1))
* remove upload drive sync firefox ([8205b82](https://github.com/softwarePhoenixbox/redgifs-extension/commit/8205b82ec83dc76e25b237748e53892b4f200648))
* trigger release for extension fixes ([9295429](https://github.com/softwarePhoenixbox/redgifs-extension/commit/9295429dbc9d66333f5a8fc66e1bf51fe895cef2))

## [0.3.5](https://github.com/softwarePhoenixbox/redgifs-extension/compare/redgifs-extension-v0.3.4...redgifs-extension-v0.3.5) (2026-10-14)

### Changed

* popup: el distintivo del plan (Free / Premium / «Premium (activated build)») ahora muestra solo una estrella, en cualquier edición. El texto y los usos restantes pasan al tooltip.

## [0.3.4](https://github.com/softwarePhoenixbox/redgifs-extension/compare/redgifs-extension-v0.3.3...redgifs-extension-v0.3.4) (2026-10-14)

### Fixed

* Firefox: el ajuste «Destino de descargas» mostraba «Choose a folder (any drive)» deshabilitado, porque Firefox no puede elegir carpetas (no tiene `showDirectoryPicker`). Ahora, sin selector de carpetas, el popup solo muestra la subcarpeta opcional dentro de la carpeta de descargas del navegador. En Chrome no cambia nada.

## 0.3.3.1 (2026-10-14)

### Fixed

* Firefox (AMO): se eliminan las asignaciones a `innerHTML` del código propio (panel flotante y botones de descarga, también en Reddit) para quitar el aviso «Unsafe assignment to innerHTML» del validador. El HTML se interpreta ahora con `DOMParser` (`utils/safe-html.ts`); el resultado en pantalla es idéntico. Los avisos que quedan pertenecen a React (`react-dom`) y no son de este código.

## [0.3.3](https://github.com/softwarePhoenixbox/redgifs-extension/compare/redgifs-extension-v0.3.2...redgifs-extension-v0.3.3) (2026-10-14)

### Fixed

* Firefox: el manifest ahora declara el ID del complemento en AMO (`browser_specific_settings.gecko.id`). Sin él, Mozilla rechazaba la subida con «The add-on ID in your manifest.json does not match the ID of your add-on on AMO».

## [0.3.2](https://github.com/softwarePhoenixbox/redgifs-extension/compare/redgifs-extension-v0.3.1...redgifs-extension-v0.3.2) (2026-10-14)

### Fixed

* descargas con barra de progreso muy lentas: el archivo se bajaba por una sola conexión, que el CDN limita. Ahora se baja en hasta 8 tramos en paralelo (Range) y se arma en memoria; si el servidor no soporta Range, se usa la descarga de una conexión como antes.

## [0.3.1](https://github.com/softwarePhoenixbox/redgifs-extension/compare/redgifs-extension-v0.3.0...redgifs-extension-v0.3.1) (2026-10-14)

### Fixed

* carpeta elegida: el popup mostraba «Ready» aunque el documento que guarda las descargas no tenía permiso de escritura, y la descarga caía a la carpeta del navegador. «Ready» ahora solo aparece tras una escritura de prueba real hecha por ese documento.
* «Authorize» ahora abre la pestaña de la extensión (Chrome solo ofrece «Permitir en cada visita» sobre una pestaña, no sobre el popup), y esa página también verifica la escritura al terminar.
* mensaje de permiso más claro cuando Chrome pide autorizar de nuevo la carpeta.

## [0.3.0](https://github.com/softwarePhoenixbox/redgifs-extension/compare/redgifs-extension-v0.2.0...redgifs-extension-v0.3.0) (2026-10-14)


### Added

* ajuste «Destino de descargas» en el popup: carpeta predeterminada del navegador o una carpeta elegida (cualquier disco, solo Chromium) con subcarpeta opcional que se crea sola si no existe o se borró.
* página `folder` para elegir la carpeta y pedir el permiso de escritura (el selector nativo cierra el popup).
* ajustes `rgOutputMode`, `rgOutputSubfolder`, `rgOutputCustomName`; mensaje interno `RG_OFFSCREEN_SAVE` y campo opcional `folder_warning` en las respuestas de descarga (aditivos).

### Changed

* el texto de confirmación de la descarga ya no dice «Descargas/redgifs» fijo. Sin tocar los ajustes se sigue guardando en `Descargas/redgifs`, igual que antes.

## [0.2.0](https://github.com/softwarePhoenixbox/redgifs-extension/compare/redgifs-extension-v0.1.55...redgifs-extension-v0.2.0) (2026-10-14)


### Added

* barra de progreso en el botón Download: una línea debajo del botón avanza de 0 a 100 % mientras se descarga (indeterminada si el servidor no informa el tamaño).
* mensaje interno `RG_DOWNLOAD_PROGRESS` (offscreen/background → content script) y campo opcional `progressId` en `RG_DOWNLOAD`; es aditivo, los clientes anteriores siguen funcionando.

### Changed

* el botón Download ya no muestra el texto «Preparing…»; mientras descarga, el icono y el texto pasan a azul y se muestra el porcentaje.

## [0.1.55](https://github.com/softwarePhoenixbox/redgifs-extension/compare/redgifs-extension-v0.1.53...redgifs-extension-v0.1.55) (2026-09-25)


### Bug Fixes

* trigger release for extension fixes ([9295429](https://github.com/softwarePhoenixbox/redgifs-extension/commit/9295429dbc9d66333f5a8fc66e1bf51fe895cef2))
