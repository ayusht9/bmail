const storageKey = 'bmail-pane-sizes';
let preferences = {};
try { preferences = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch {}
if (typeof preferences !== 'object' || Array.isArray(preferences)) preferences = {};
let drag = null;
export const paneResizeActive = () => Boolean(drag);
const bound = (value, min, max) => Math.max(min, Math.min(max, value));
const railWidth = 56;
const collapseThreshold = 120;

export function sidebarToggle() {
  const label = preferences.collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return `<button type="button" class="sidebar-toggle" data-action="toggle-sidebar" aria-controls="folder-sidebar" aria-expanded="${!preferences.collapsed}" aria-label="${label}" title="${label}"><svg aria-hidden="true" viewBox="0 0 20 20"><rect x="2" y="3" width="16" height="14" rx="2"/><path d="M7 3v14m6-10-3 3 3 3"/></svg></button>`;
}

export function toggleSidebar(root, focusTarget) {
  root.querySelector('.desktop-layout')?.classList.add('sidebar-animate');
  preferences.collapsed = focusTarget ? false : !preferences.collapsed;
  apply(root); save();
  if (focusTarget) root.querySelector(focusTarget)?.focus({ preventScroll: true });
}

export function paneDivider(kind, label) {
  const sidebar = kind === 'sidebar';
  return `<div class="pane-divider ${sidebar ? 'sidebar-divider' : 'mail-divider'}" role="separator" tabindex="0" aria-label="${label || (sidebar ? 'Resize folder sidebar' : 'Resize mail list and reading pane')}" aria-orientation="${sidebar ? 'vertical' : 'horizontal'}" data-pane-divider="${kind}" title="Drag or use arrow keys to resize; double-click to reset"></div>`;
}

function save() { try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch {} }
function defaultSidebar() { return innerWidth <= 850 ? 166 : innerWidth <= 1050 ? 184 : 224; }
function apply(root) {
  const layout = root.querySelector('.desktop-layout');
  if (layout) {
    const max = Math.max(160, layout.clientWidth - 440);
    const width = drag?.kind === 'sidebar' ? bound(drag.width ?? drag.start, railWidth, max)
      : preferences.collapsed ? railWidth : bound(Number.isFinite(preferences.sidebar) ? preferences.sidebar : defaultSidebar(), 160, max);
    layout.style.setProperty('--sidebar-width', `${width}px`);
    layout.style.setProperty('--sidebar-label-opacity', bound((width - 100) / 60, 0, 1));
    layout.style.setProperty('--sidebar-action-progress', bound((width - collapseThreshold) / (160 - collapseThreshold), 0, 1));
    layout.classList.toggle('sidebar-collapsed', Boolean(preferences.collapsed));
    const divider = layout.querySelector('[data-pane-divider="sidebar"]');
    divider?.setAttribute('aria-valuenow', Math.round(width)); divider?.setAttribute('aria-valuemin', railWidth); divider?.setAttribute('aria-valuemax', max);
    divider?.setAttribute('aria-valuetext', preferences.collapsed ? 'Collapsed, icons only' : `${Math.round(width)} pixels`);
    const toggle = root.querySelector('.sidebar-toggle');
    const label = preferences.collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggle?.setAttribute('aria-expanded', String(!preferences.collapsed));
    toggle?.setAttribute('aria-label', label); toggle?.setAttribute('title', label);
  }
  const panes = root.querySelector('.mailbox-panes');
  if (panes && panes.clientHeight) {
    const available = Math.max(0, panes.clientHeight - 6);
    const min = Math.min(120, available / 2);
    const max = Math.max(min, available - Math.min(140, available / 2));
    const ratio = Number.isFinite(preferences.mailRatio) ? preferences.mailRatio : .42;
    const height = bound(available * ratio, min, max);
    panes.style.setProperty('--mail-list-height', `${height}px`);
    const divider = panes.querySelector('[data-pane-divider="mail"]');
    divider?.setAttribute('aria-valuenow', Math.round(height)); divider?.setAttribute('aria-valuemin', Math.round(min)); divider?.setAttribute('aria-valuemax', Math.round(max));
  }
}

export function installPaneResizing(root) {
  const observed = new Set();
  const observer = new ResizeObserver(() => apply(root));
  const sync = () => {
    for (const element of observed) if (!element.isConnected) { observer.unobserve(element); observed.delete(element); }
    root.querySelectorAll('.desktop-layout, .mailbox-panes').forEach(element => { if (!observed.has(element)) { observed.add(element); observer.observe(element); } });
    apply(root);
  };
  new MutationObserver(sync).observe(root, { subtree: true, childList: true });
  sync();
  root.addEventListener('pointerdown', event => {
    const divider = event.target.closest('[data-pane-divider]');
    if (!divider || event.button !== 0) return;
    const kind = divider.dataset.paneDivider;
    drag = { kind, id: event.pointerId, x: event.clientX, y: event.clientY,
      start: kind === 'sidebar' ? root.querySelector('.folder-sidebar').getBoundingClientRect().width : Number(divider.getAttribute('aria-valuenow')) };
    divider.setPointerCapture(event.pointerId);
    document.body.classList.add(kind === 'sidebar' ? 'resizing-sidebar' : 'resizing-mail');
    apply(root);
    event.preventDefault();
  });
  function resize(kind, value) {
    const divider = root.querySelector(`[data-pane-divider="${kind}"]`);
    if (!divider) return;
    const size = bound(value, Number(divider.getAttribute('aria-valuemin')), Number(divider.getAttribute('aria-valuemax')));
    if (kind === 'sidebar') {
      if (drag?.kind === 'sidebar') drag.width = size;
      else {
        root.querySelector('.desktop-layout')?.classList.add('sidebar-animate');
        preferences.collapsed = size <= collapseThreshold;
        if (!preferences.collapsed) preferences.sidebar = Math.max(160, size);
      }
    }
    else preferences.mailRatio = size / Math.max(1, root.querySelector('.mailbox-panes').clientHeight - 6);
    apply(root);
  }
  root.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    resize(drag.kind, drag.start + (drag.kind === 'sidebar' ? event.clientX - drag.x : event.clientY - drag.y));
  });
  const finish = event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.kind === 'sidebar') {
      root.querySelector('.desktop-layout')?.classList.add('sidebar-animate');
      const width = drag.width ?? drag.start;
      preferences.collapsed = width <= collapseThreshold;
      if (!preferences.collapsed) preferences.sidebar = Math.max(160, width);
    }
    drag = null;
    document.body.classList.remove('resizing-sidebar', 'resizing-mail');
    apply(root); save();
  };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) root.addEventListener(name, finish);
  root.addEventListener('keydown', event => {
    const divider = event.target.closest('[data-pane-divider]');
    if (!divider) return;
    const kind = divider.dataset.paneDivider;
    const keys = kind === 'sidebar' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const current = Number(divider.getAttribute('aria-valuenow'));
    const delta = (event.key === keys[0] ? -1 : 1) * (event.shiftKey ? 40 : 10);
    const next = kind === 'sidebar' && current === railWidth && delta > 0 ? 160
      : kind === 'sidebar' && current === 160 && delta < 0 ? railWidth : current + delta;
    resize(kind, next);
    save();
  });
  root.addEventListener('dblclick', event => {
    const divider = event.target.closest('[data-pane-divider]');
    if (!divider) return;
    delete preferences[divider.dataset.paneDivider === 'sidebar' ? 'sidebar' : 'mailRatio'];
    if (divider.dataset.paneDivider === 'sidebar') {
      preferences.collapsed = false;
      root.querySelector('.desktop-layout')?.classList.add('sidebar-animate');
    }
    apply(root); save();
  });
}
