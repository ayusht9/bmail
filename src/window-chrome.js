import { getCurrentWindow } from '@tauri-apps/api/window';

export function startupHeader(logoUrl) {
  return `<header class="app-toolbar" data-tauri-drag-region><div class="app-name" data-tauri-drag-region><img class="app-logo" src="${logoUrl}" alt="" width="28" height="28"><strong>Bmail</strong></div><div class="toolbar-spacer" data-tauri-drag-region></div>${windowControls()}</header>`;
}

export function windowControls() {
  const controls = [
    ['minimize', 'Minimize window', '<path d="M4 10h12"/>'],
    ['maximize', 'Maximize or restore window', '<rect x="4.5" y="4.5" width="11" height="11"/>'],
    ['close', 'Close window', '<path d="m5 5 10 10M15 5 5 15"/>'],
  ];
  return `<div class="window-controls" role="group" aria-label="Window controls">${controls.map(([action, label, icon]) => `<button type="button" class="window-${action}" data-action="window-${action}" aria-label="${label}" title="${label}"><svg viewBox="0 0 20 20" aria-hidden="true">${icon}</svg></button>`).join('')}</div>`;
}

export function controlWindow(action) {
  const window = getCurrentWindow();
  if (action === 'window-minimize') return window.minimize();
  if (action === 'window-maximize') return window.toggleMaximize();
  if (action === 'window-close') return window.close();
}
