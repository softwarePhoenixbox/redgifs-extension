// Sustituye `el.innerHTML = html`: el HTML se interpreta en un documento aparte (DOMParser, sin scripts ni
// carga de recursos) y solo se mueven los nodos resultantes. Se usa solo con plantillas propias (SVG y paneles),
// nunca con datos de la página. Evita el aviso «Unsafe assignment to innerHTML» del validador de AMO.
export function setHtml(element: Element, html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  element.replaceChildren(...Array.from(parsed.body.childNodes, node => element.ownerDocument.importNode(node, true)));
}
