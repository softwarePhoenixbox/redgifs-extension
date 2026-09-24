# Guía de problemas resueltos en extensiones WebExtension

Esta guía recoge fallos que encontramos al desarrollar y probar una extensión para Chrome y Firefox. Sirve como lista de diagnóstico para proyectos futuros; cada extensión y cada API pueden tener diferencias.

## 1. Chrome y Firefox no son idénticos

Una extensión puede funcionar en Chrome y fallar en Firefox aunque use el mismo código fuente. WXT genera paquetes distintos según el navegador y algunas API tienen diferencias de permisos, ciclo de vida y descarga.

**Qué revisar**

- Configuración y manifiesto generados para cada navegador, no solo el manifiesto fuente.
- Permisos de `browser_specific_settings`, `host_permissions` y APIs que use cada build.
- Consola de la página, consola del background y página de errores de la extensión. El mensaje que aparece en una no necesariamente aparece en las otras.
- Si un error sucede solo después de desplazarse o repetir una acción, comprobar que el listener siga vivo y que el mensaje se envíe al contexto correcto.

**Comandos habituales con WXT**

```powershell
pnpm compile
pnpm wxt build -b chrome
pnpm wxt build -b firefox
pnpm exec web-ext lint --source-dir .output/firefox-mv2
pnpm wxt zip -b chrome
pnpm wxt zip -b firefox
```

Instalar y probar el paquete recién generado. No asumir que una compilación exitosa confirma el comportamiento en el navegador.

## 2. Mensajes entre content script, background y offscreen

**Síntoma:** la primera descarga funciona y una acción posterior muestra que el background no respondió; también puede aparecer al descargar un elemento que se encontró después de hacer scroll.

**Causas que encontramos:** listeners de `runtime.onMessage` devolvían una respuesta asíncrona incluso para mensajes que no les correspondían, o se usó un estilo de listener que no es compatible de la misma forma con Chrome y Firefox. Eso puede dejar una solicitud esperando hasta timeout o interferir con otro listener.

**Patrón de diagnóstico y corrección**

1. Registrar tipo de mensaje, emisor, ID del elemento, inicio, final y error en el background.
2. Confirmar que cada contexto solo atienda los tipos de mensaje que conoce.
3. Ignorar mensajes ajenos de forma síncrona; responder únicamente a los propios.
4. Si el listener usa `sendResponse` y trabajo asíncrono, devolver `true` solo para el mensaje que realmente responderá más tarde.
5. No tener varios listeners que respondan por el mismo mensaje.
6. Poner timeout y manejo explícito de rechazo en el lado emisor, mostrando al usuario qué operación falló.

En particular, el documento offscreen de Chrome debe filtrar su mensaje de preparación de Blob antes de entrar al camino asíncrono. Los mensajes normales del background no deben activar ese listener.

## 3. Acciones e iconos en listas que cargan al desplazarse

**Síntoma:** el icono de descarga aparece en los primeros videos, pero los videos agregados después del scroll no tienen el icono o el icono falla.

Las páginas con scroll infinito crean y destruyen tarjetas dinámicamente. Ejecutar una sola búsqueda DOM al cargar la página no alcanza.

**Buenas prácticas**

- Observar cambios del DOM con `MutationObserver` y detectar elementos nuevos.
- Hacer el procesamiento idempotente: marcar una tarjeta ya procesada o comprobar si ya tiene el botón para no duplicarlo.
- No guardar referencias indefinidas a nodos que el sitio reemplaza.
- Al hacer clic, volver a leer el ID del elemento desde la tarjeta actual y enviar ese ID al background.
- Si cambia el video activo, actualizar la tarjeta desde el DOM actual, no desde el primer video detectado.
- Probar el primer elemento, uno tras varios scrolls, y varias descargas consecutivas.

## 4. Error HTTP 405 al resolver un video mediante una API

**Síntoma:** la extensión muestra `Error 405 al consultar la API` en Firefox.

Un 405 es una respuesta HTTP del servidor: la petición llegó, pero el servidor rechazó el método o la forma de esa petición. No es suficiente cambiar permisos sin inspeccionar endpoint, método, cabeceras y cuerpo de respuesta.

**Diagnóstico aplicado a RedGifs**

- Usar la ruta documentada/esperada y codificar el ID antes de formar la URL.
- Obtener y conservar el token temporal; ante 401, renovar el token y reintentar una vez.
- Enviar `Authorization: Bearer ...`, `Accept`, `Content-Type`, `Referer` y `X-CustomHeader` cuando la API los espera. El navegador controla la cabecera `Origin`; no intentar falsificarla desde `fetch`.
- Mantener el `Referer` en el sitio de RedGifs y solicitar los datos necesarios para esa consulta.
- Mostrar el status, ruta y un fragmento limitado del cuerpo de error para que el siguiente diagnóstico distinga 401, 403, 404, 405 y 429.
- No registrar tokens ni cabeceras de autorización en la consola.

La estructura de las APIs puede cambiar. Contrastar cualquier endpoint con documentación actual o con clientes mantenidos, por ejemplo el [extractor RedGifs de yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/redgifs.py), y volver a comprobarlo antes de reutilizarlo.

## 5. Descarga de MP4 con metadatos de Windows

**Objetivo:** que el archivo MP4 descargado muestre propiedades como título, autor y tags en el Explorador de Windows.

Los metadatos de una página web no se convierten automáticamente en propiedades del archivo. La extensión debe extraerlos, pasarlos por el mensaje de descarga y escribirlos dentro del contenedor MP4 antes de iniciar la descarga.

**Comprobaciones**

- Verificar que cada campo se extrajo con el selector correcto y que no llega como `null` o cadena vacía.
- Verificar que el mensaje content → background lleva `title`, `author`, `tags` y `pageUrl`.
- Mantener coherentes los nombres de propiedades de Windows (por ejemplo `WM/Title`, `WM/Author`, tags y URL promocional) y los átomos QuickTime/MP4 pertinentes. Un único átomo no necesariamente aparece en todas las columnas del Explorador.
- Confirmar que el archivo final sigue siendo MP4 válido y que los metadatos se escribieron antes de descargarlo.
- En Windows, configurar las columnas de la carpeta y actualizar/reabrir la vista; el Explorador puede conservar valores indexados o no mostrar una propiedad aunque esté presente en el archivo.
- Probar con un archivo nuevo y revisar sus propiedades, no solo el estado mostrado por la extensión.

La columna URL del Explorador no es una columna universal equivalente al enlace de la página. Si se necesita conservar la dirección de origen, guardar una propiedad compatible y/o un archivo acompañante con la URL, y validar cómo lo presenta la versión de Windows del usuario.

## 6. FFmpeg no está instalado

No asumir que el cliente tiene FFmpeg ni instalar software en su equipo sin consentimiento. La descarga debe continuar de manera controlada:

1. Detectar si la tarea realmente necesita FFmpeg.
2. Si el binario no está disponible, descargar el video original sin transformación/metadatos.
3. Informar claramente que se descargó sin metadatos porque FFmpeg no está disponible.
4. No presentar como éxito una incrustación que no ocurrió.
5. Si se usa FFmpeg WASM, comprobar tamaño, inicialización, disponibilidad de WASM y memoria; no descargar el motor repetidamente por cada video.

## 7. URLs `blob:` y descargas repetidas

Los `blob:` URL tienen dueño y ciclo de vida. Si se revocan demasiado pronto, la descarga puede fallar; si nunca se revocan, se acumula memoria.

- Esperar el evento de descarga completada/interrumpida antes de revocar el URL.
- Relacionar cada URL temporal con su ID de descarga; no reutilizar una sola variable global para operaciones simultáneas.
- En Chrome, un documento offscreen puede crear el Blob cuando haga falta.
- En Firefox, validar la ruta de descarga permitida por su background y no asumir que acepta los mismos Blob URL que Chrome.
- Añadir fallback explícito: si falla la preparación de metadatos, descargar el original y comunicar que no lleva metadatos.
- Probar dos o más descargas seguidas, descargas simultáneas y errores a mitad de operación.

## 8. Ajustes del popup y estado sincronizado

Cuando un ajuste habilita o deshabilita una función de la página (por ejemplo el panel flotante o el icono de descarga):

- Guardar el ajuste en `storage.local`.
- Leer el valor al iniciar cada content script; definir el comportamiento por defecto cuando no hay valor guardado.
- Escuchar `storage.onChanged` para que un cambio desde el popup se aplique sin recargar la pestaña.
- Retirar del DOM los controles deshabilitados y evitar que queden listeners activos.
- Probar activar/desactivar, recargar la página y abrir otra pestaña.

## 9. Firefox Add-ons y paquete de código fuente

La validación de AMO y la ejecución local son comprobaciones diferentes. Si AMO pide código fuente, cargar el ZIP con el código necesario para que una persona revisora pueda reproducir el build, no el ZIP instalable de Firefox.

Antes de subir:

- Elegir “Yes” en la declaración de código generado/agrupado si el proyecto usa herramientas que transforman o combinan código (por ejemplo WXT/Vite), plantillas o WASM; declarar honestamente las herramientas usadas.
- Adjuntar instrucciones de build, entorno y versiones requeridas, además del código fuente propio.
- Asegurarse de no incluir secretos, tokens de sesión ni datos personales.
- Ejecutar `web-ext lint` y leer tanto errores como advertencias. Un aviso de ID de Firefox debe resolverse definiendo un ID estable en `browser_specific_settings.gecko.id` para una publicación mantenida.
- No confundir warnings de lint con la causa de un error de ejecución; buscar el error concreto en el informe y las consolas pertinentes.

## 10. Rutina de depuración para el próximo fallo

1. Reproducir en un perfil limpio y anotar navegador, versión, URL y pasos exactos.
2. Comparar Chrome y Firefox con la misma operación y el mismo elemento.
3. Revisar consola de página, consola del background y errores de la extensión.
4. Añadir logs breves con un ID de correlación por operación; ocultar datos sensibles.
5. Inspeccionar la petición de red: URL, método, status y cuerpo seguro de la respuesta.
6. Revisar el trayecto completo: DOM → content script → mensaje → background/API → descarga → archivo final.
7. Probar el primer elemento, un elemento tras varios scrolls, segunda descarga, errores de red y ausencia de dependencia externa.
8. Compilar y generar por separado ambos navegadores; inspeccionar los dos manifiestos generados.
9. Instalar el ZIP recién construido y repetir la reproducción manualmente.
10. Anotar en esta guía el síntoma, causa raíz, cambio y evidencia de verificación.

## Checklist breve antes de entregar

- [ ] TypeScript compila.
- [ ] Se generan builds separados para Chrome y Firefox.
- [ ] `web-ext lint` no tiene errores; las advertencias se revisan.
- [ ] El manifiesto final contiene permisos y ajustes del navegador correctos.
- [ ] Los listeners ignoran mensajes ajenos y no dejan solicitudes pendientes.
- [ ] Los controles dinámicos siguen funcionando después del scroll.
- [ ] Se probaron varias descargas consecutivas.
- [ ] El fallback sin FFmpeg/metadatos informa lo que pasó.
- [ ] El archivo descargado y sus propiedades se verificaron en Windows.
- [ ] La prueba se hizo con el paquete recién generado, no con una versión anterior instalada.
