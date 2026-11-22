// Keep navigation connected during redraws. Pointer guards cannot protect a
// keyboard activation or every native WebView event ordering.
export function renderWorkspace(root, html) {
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = html;
  const selector = '.workspace-navigation';
  const current = root.querySelector(selector);
  const next = template.content.querySelector(selector);
  if (!current || !next) { root.replaceChildren(template.content); return; }

  const attributes = (element, replacement) => {
    // The pane controller owns these values. Keep them on the connected layout
    // while replacing its children so navigation never paints an expanded rail.
    if (element.classList.contains('desktop-layout')) {
      for (const name of ['sidebar-collapsed', 'sidebar-animate']) {
        replacement.classList.toggle(name, element.classList.contains(name));
      }
      for (const name of ['--sidebar-width', '--sidebar-label-opacity', '--sidebar-action-progress']) {
        const value = element.style.getPropertyValue(name);
        if (value) replacement.style.setProperty(name, value);
      }
    }
    for (const { name } of [...element.attributes]) if (!replacement.hasAttribute(name)) element.removeAttribute(name);
    for (const { name, value } of replacement.attributes) if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  };
  // Every navigation control has a stable ID or data-action.
  for (const control of current.querySelectorAll('button')) {
    const replacement = [...next.querySelectorAll('button')].find(button => control.id
      ? button.id === control.id : button.dataset.action === control.dataset.action);
    if (replacement) attributes(control, replacement);
  }
  const currentPath = [], nextPath = [];
  for (let node = current; node !== root; node = node.parentNode) currentPath.unshift(node);
  for (let node = next; node !== template.content; node = node.parentNode) nextPath.unshift(node);
  // Fall back if a future layout changes the navigation's ancestor structure.
  if (currentPath.length !== nextPath.length || currentPath.some((node, i) => node.tagName !== nextPath[i].tagName)) {
    root.replaceChildren(template.content); return;
  }
  let parent = root;
  for (let i = 0; i < currentPath.length; i++) {
    const retained = currentPath[i], replacement = nextPath[i];
    attributes(retained, replacement);
    for (const child of [...parent.childNodes]) if (child !== retained) child.remove();
    const siblings = [...replacement.parentNode.childNodes];
    const position = siblings.indexOf(replacement);
    const before = siblings.slice(0, position), after = siblings.slice(position + 1);
    for (const child of before) parent.insertBefore(child, retained);
    for (const child of after) parent.append(child);
    parent = retained;
  }
}
