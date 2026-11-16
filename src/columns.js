const defaults = { mail: [280, 200, 150, 190, 52], folders: [260, 130, 130, 130, 52] };
const layouts = new Map();
const minimum = index => index === 4 ? 44 : 72;
const clamp = (width, index) => Math.round(Math.min(1200, Math.max(minimum(index), width)));
let dragging = null;
export const columnResizeActive = () => Boolean(dragging);

function widthsFor(id) {
  if (!layouts.has(id)) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(`bmail-columns-${id}`)); } catch { /* Use defaults when storage is unavailable. */ }
    layouts.set(id, Array.isArray(saved) && saved.length === 5 && saved.every(Number.isFinite) ? saved.map(clamp) : null);
  }
  return layouts.get(id);
}

export function tableStart(id, className) {
  const saved = widthsFor(id);
  const widths = saved || defaults[id];
  const sum = widths.reduce((total, width) => total + width, 0);
  return `<table class="${className} resizable-table" data-resize-table="${id}" ${saved ? `style="width:${sum}px;min-width:100%"` : ''}><colgroup>${widths.map((width, index) => `<col style="width:${saved ? index === 4 ? 'auto' : `${width}px` : `${width / sum * 100}%`}">`).join('')}</colgroup>`;
}

export function columnHandle(id, index, label) {
  const width = widthsFor(id)?.[index] || defaults[id][index];
  return `<span class="column-resize" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize ${label} column" aria-valuemin="${minimum(index)}" aria-valuemax="1200" aria-valuenow="${width}" data-resize-column="${index}" title="Drag to resize; double-click to fit contents; use left and right arrow keys"></span>`;
}

function applyWidths(table, widths) {
  table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
  table.style.minWidth = '100%';
  table.querySelectorAll('col').forEach((col, index) => col.style.width = index === widths.length - 1 ? 'auto' : `${widths[index]}px`);
  table.querySelectorAll('[data-resize-column]').forEach((handle, index) => handle.setAttribute('aria-valuenow', widths[index]));
}
function saveWidths(table, widths) {
  const id = table.dataset.resizeTable;
  layouts.set(id, widths);
  try { localStorage.setItem(`bmail-columns-${id}`, JSON.stringify(widths)); } catch { /* Keep this session's widths. */ }
}

function fitColumn(table, index) {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return;
  let widest = minimum(index);
  for (const row of table.rows) {
    const cell = row.cells[index];
    if (!cell || cell.colSpan > 1) continue;
    const style = getComputedStyle(cell);
    const button = cell.querySelector('button');
    const textStyle = button ? getComputedStyle(button) : style;
    context.font = textStyle.font;
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('.column-resize, .sr-only').forEach(element => element.remove());
    const text = clone.textContent.trim();
    const lines = text.split(/\r?\n/);
    const textWidth = Math.max(...lines.map(line => context.measureText(line).width));
    const icons = [...cell.querySelectorAll('svg')].reduce((sum, svg) => sum + svg.getBoundingClientRect().width, 0);
    const buttonStyle = button ? getComputedStyle(button) : null;
    const extra = buttonStyle ? parseFloat(buttonStyle.paddingLeft) + parseFloat(buttonStyle.paddingRight) + (parseFloat(buttonStyle.columnGap) || 0) : 0;
    widest = Math.max(widest, Math.ceil(textWidth + icons + extra + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 4));
  }
  const widths = [...table.querySelectorAll('thead th')].map((th, i) => clamp(th.getBoundingClientRect().width, i));
  widths[index] = clamp(widest, index);
  applyWidths(table, widths);
  saveWidths(table, widths);
}

export function installColumnResizing(root) {
  root.addEventListener('dblclick', event => {
    const handle = event.target.closest('[data-resize-column]');
    if (!handle) return;
    event.preventDefault();
    fitColumn(handle.closest('[data-resize-table]'), Number(handle.dataset.resizeColumn));
  });
  root.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-resize-column]');
    if (!handle || event.button !== 0) return;
    const table = handle.closest('[data-resize-table]');
    const widths = [...table.querySelectorAll('thead th')].map((th, index) => clamp(th.getBoundingClientRect().width, index));
    const index = Number(handle.dataset.resizeColumn);
    dragging = { table, widths, index, startX: event.clientX, startWidth: widths[index], pointerId: event.pointerId };
    applyWidths(table, widths);
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-columns');
    event.preventDefault();
  });
  root.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    dragging.widths[dragging.index] = clamp(dragging.startWidth + event.clientX - dragging.startX, dragging.index);
    applyWidths(dragging.table, dragging.widths);
  });
  const finish = event => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    saveWidths(dragging.table, dragging.widths);
    dragging = null;
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    document.body.classList.remove('resizing-columns');
  };
  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', finish);
  root.addEventListener('lostpointercapture', finish);
  root.addEventListener('keydown', event => {
    const handle = event.target.closest('[data-resize-column]');
    if (!handle || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const table = handle.closest('[data-resize-table]');
    const index = Number(handle.dataset.resizeColumn);
    const widths = [...table.querySelectorAll('thead th')].map((th, i) => clamp(th.getBoundingClientRect().width, i));
    widths[index] = clamp(widths[index] + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 40 : 10), index);
    applyWidths(table, widths); saveWidths(table, widths);
  });
}
