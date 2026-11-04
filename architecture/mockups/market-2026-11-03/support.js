// Minimal standalone renderer for the mockup: sc-for + {{path}} substitution.
window.DCLogic = class {};
document.addEventListener('DOMContentLoaded', () => {
  const src = document.querySelector('script[data-dc-script]').textContent;
  const Comp = new Function('DCLogic', src + '\nreturn Component;')(window.DCLogic);
  const vals = new Comp().renderVals();
  const get = (scope, path) => path.trim().split('.').reduce((o, k) => (o == null ? o : o[k]), scope);
  const sub = (s, scope) => s.replace(/\{\{([^}]+)\}\}/g, (_, p) => { const v = get(scope, p); return v == null ? '' : v; });
  function render(node, scope) {
    if (node.nodeType === 3) { node.textContent = sub(node.textContent, scope); return; }
    if (node.nodeType !== 1) return;
    if (node.tagName === 'SC-FOR') {
      const list = get(scope, node.getAttribute('list').replace(/^\{\{|\}\}$/g, '')) || [];
      const as = node.getAttribute('as');
      const frag = document.createDocumentFragment();
      for (const item of list) {
        for (const child of node.childNodes) {
          const c = child.cloneNode(true);
          frag.appendChild(c);
          render(c, Object.assign({}, scope, { [as]: item }));
        }
      }
      node.replaceWith(frag);
      return;
    }
    for (const a of Array.from(node.attributes)) if (a.value.includes('{{')) node.setAttribute(a.name, sub(a.value, scope));
    for (const c of Array.from(node.childNodes)) render(c, scope);
  }
  const helmet = document.querySelector('helmet');
  if (helmet) { for (const c of Array.from(helmet.childNodes)) document.head.appendChild(c); helmet.remove(); }
  const root = document.querySelector('x-dc');
  render(root, vals);
  document.body.dataset.rendered = '1';
});
