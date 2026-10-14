# Changelog

## [0.2.0](https://github.com/softwarePhoenixbox/redgifs-extension/compare/redgifs-extension-v0.1.55...redgifs-extension-v0.2.0) (2026-10-14)


### Added

* barra de progreso en el botón Download: una línea debajo del botón avanza de 0 a 100 % mientras se descarga (indeterminada si el servidor no informa el tamaño).
* mensaje interno `RG_DOWNLOAD_PROGRESS` (offscreen/background → content script) y campo opcional `progressId` en `RG_DOWNLOAD`; es aditivo, los clientes anteriores siguen funcionando.

### Changed

* el botón Download ya no muestra el texto «Preparing…»; mientras descarga, el icono y el texto pasan a azul y se muestra el porcentaje.

## [0.1.55](https://github.com/softwarePhoenixbox/redgifs-extension/compare/redgifs-extension-v0.1.53...redgifs-extension-v0.1.55) (2026-09-25)


### Bug Fixes

* trigger release for extension fixes ([9295429](https://github.com/softwarePhoenixbox/redgifs-extension/commit/9295429dbc9d66333f5a8fc66e1bf51fe895cef2))
