import { userMessage } from './errors.js';
import { createNotificationStore } from './notification-store.js';

const storageKey = 'bmail-notifications';
const retainNotification = key => typeof key === 'string' && (key.startsWith('mail:') || key.startsWith('backup:') && key.endsWith(':completed'));
const icons = {
  success: '<path d="m6 10 3 3 5-6"/><circle cx="10" cy="10" r="8"/>',
  error: '<circle cx="10" cy="10" r="8"/><path d="M10 5v6m0 3v1"/>',
  info: '<circle cx="10" cy="10" r="8"/><path d="M10 9v6m0-10v1"/>',
};
const svg = (content, className = '') => `<svg class="${className}" viewBox="0 0 20 20" aria-hidden="true">${content}</svg>`;
const closeIcon = svg('<path d="m5 5 10 10M15 5 5 15"/>');
const titles = { success: 'Success', error: 'Error', info: 'Notice' };

export function createNotificationCenter({ account, escape, date, onChange }) {
  const store = createNotificationStore({
    read: () => { const saved = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(saved) ? saved.filter(item => item && retainNotification(item.key)) : []; },
    write: items => localStorage.setItem(storageKey, JSON.stringify(items)),
    readState: () => JSON.parse(localStorage.getItem(`${storageKey}-state`) || '{}'),
    writeState: state => localStorage.setItem(`${storageKey}-state`, JSON.stringify(state)),
  });
  let toasts = [];
  let transientSerial = 0;
  const timers = new Map();
  const lifetimes = new Map();
  let currentAccount = '';
  let opened = false;

  function positionPanel() {
    const button = document.querySelector('.navbar-notifications .notification-bell');
    const dialog = document.querySelector('#notification-dialog');
    if (!button || !dialog) return;
    const bounds = button.getBoundingClientRect();
    const top = Math.max(8, Math.min(window.innerHeight - 80, bounds.bottom + 8));
    dialog.style.top = `${top}px`;
    dialog.style.right = `${Math.max(12, window.innerWidth - bounds.right)}px`;
    dialog.style.maxHeight = `${Math.max(60, Math.min(580, window.innerHeight - top - 12))}px`;
  }
  window.addEventListener('resize', () => { if (opened) positionPanel(); });

  function bell() {
    const count = store.unread(account());
    return `<button type="button" class="notification-bell" data-action="notifications-open" aria-label="Notifications${count ? `, ${count} unread` : ''}" title="Notifications" aria-haspopup="dialog" aria-expanded="${opened}" aria-controls="notification-dialog">${svg('<path d="M4 8a6 6 0 0 1 12 0v5l2 2H2l2-2Zm4 9h4"/>')}${count ? `<span class="notification-count">${count > 99 ? '99+' : count}</span>` : ''}</button>`;
  }
  function panel() {
    const items = store.list(account());
    const unread = store.unread(account());
    return `<header class="notification-panel-header"><div><h2 id="notification-title">Notifications</h2><p>${unread ? `${unread} unread` : 'No unread notifications'}</p></div><button type="button" class="notification-icon-button" data-action="notifications-close" aria-label="Close notifications" title="Close notifications">${closeIcon}</button></header>
      <div class="notification-panel-actions"><button data-action="notifications-read-all" ${!unread ? 'disabled' : ''}>Mark all read</button><button data-action="notifications-clear" ${!items.length ? 'disabled' : ''}>Clear all</button></div>
      ${items.length ? `<ol class="notification-list">${items.map(item => `<li class="notification-item ${item.read ? '' : 'unread'}" data-level="${item.level}">${svg(icons[item.level], 'notification-kind')}<div class="notification-content"><div class="notification-item-heading"><strong>${item.key?.startsWith('mail:') ? 'Mailbox' : 'Backup'}</strong><time datetime="${escape(item.createdAt)}">${escape(date(item.createdAt))}</time></div><p>${escape(item.message)}</p></div>${!item.read ? `<button class="notification-icon-button" data-action="notification-read" data-id="${escape(item.id)}" aria-label="Mark notification read" title="Mark read">${svg('<path d="m4 10 4 4 8-8"/>')}</button>` : ''}</li>`).join('')}</ol>` : '<div class="notification-empty">'+svg('<path d="M4 8a6 6 0 0 1 12 0v5l2 2H2l2-2Zm4 9h4"/>')+'<h3>No notifications yet</h3><p>New email and completed backups will appear here.</p></div>'}`;
  }
  function renderToasts() {
    let root = document.querySelector('#toast');
    if (!root) {
      root = document.createElement('div');
      root.id = 'toast';
      root.className = 'toast-stack';
      root.setAttribute('aria-label', 'Recent notifications');
      document.body.append(root);
      root.addEventListener('click', event => {
        const button = event.target.closest('[data-action="toast-dismiss"]');
        if (!button) return;
        const focused = button === document.activeElement;
        dismiss(button.dataset.id);
        if (focused) (root.querySelector('button') || document.querySelector('[data-action="notifications-open"]'))?.focus({ preventScroll: true });
      });
      for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout']) root.addEventListener(type, event => {
        const item = event.target.closest('[data-toast-id]');
        if (!item || (event.relatedTarget && item.contains(event.relatedTarget))) return;
        if (type === 'pointerover' || type === 'focusin') pause(item.dataset.toastId);
        else resume(item.dataset.toastId);
      });
    }
    const signature = toasts.map(item => item.id).join('|');
    if (root.dataset.toasts === signature) return;
    root.dataset.toasts = signature;
    const template = document.createElement('template');
    template.innerHTML = toasts.map(item => `<article class="toast toast-${item.level}" data-toast-id="${escape(item.id)}" role="${item.level === 'error' ? 'alert' : 'status'}" aria-atomic="true">${svg(icons[item.level], 'toast-kind')}<div><strong>${titles[item.level]}</strong><p class="toast-message">${escape(item.message)}</p></div><button type="button" class="notification-icon-button" data-action="toast-dismiss" data-id="${escape(item.id)}" aria-label="Dismiss notification">${closeIcon}</button></article>`).join('');
    // Preserve existing nodes: replacing a hovered toast can lose its leave
    // event and leave its dismissal timer paused forever.
    for (const child of [...root.children]) if (!toasts.some(item => item.id === child.dataset.toastId)) child.remove();
    for (const child of [...template.content.children]) if (![...root.children].some(existing => existing.dataset.toastId === child.dataset.toastId)) root.append(child);
  }
  function refresh() {
    renderToasts();
    onChange?.();
    const dialog = document.querySelector('#notification-dialog');
    if (opened && dialog) {
      const html = panel();
      const focusAction = dialog.contains(document.activeElement) ? document.activeElement?.dataset?.action : null;
      const focusId = dialog.contains(document.activeElement) ? document.activeElement?.dataset?.id : null;
      const scroll = dialog.scrollTop;
      const changed = dialog.dataset.signature !== html;
      if (changed) {
        dialog.innerHTML = html;
        dialog.dataset.signature = html;
        dialog.scrollTop = scroll;
      }
      positionPanel();
      if (!dialog.open) dialog.show();
      if (changed && focusAction) ([...dialog.querySelectorAll('[data-action]:not(:disabled)')].find(button => button.dataset.action === focusAction && button.dataset.id === focusId) || dialog.querySelector('[data-action="notifications-close"]'))?.focus({ preventScroll: true });
    }
  }
  function dismiss(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    lifetimes.delete(id);
    toasts = toasts.filter(item => item.id !== id);
    renderToasts();
  }
  function resume(id) {
    clearTimeout(timers.get(id));
    const item = toasts.find(item => item.id === id);
    if (!item) return;
    const node = [...(document.querySelector('#toast')?.children || [])].find(element => element.dataset.toastId === id);
    if (node && (node.matches(':hover') || node.contains(document.activeElement))) { pause(id); return; }
    const lifetime = lifetimes.get(id) || { remaining: item.level === 'error' ? 8000 : 5000 };
    lifetime.started = Date.now();
    lifetimes.set(id, lifetime);
    timers.set(id, setTimeout(() => dismiss(id), lifetime.remaining));
  }
  function pause(id) {
    const lifetime = lifetimes.get(id);
    if (lifetime && timers.has(id)) lifetime.remaining = Math.max(0, lifetime.remaining - (Date.now() - lifetime.started));
    clearTimeout(timers.get(id)); timers.delete(id);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) for (const item of [...toasts]) dismiss(item.id);
  });
  function close() {
    opened = false;
    document.querySelector('#notification-dialog')?.close();
    onChange?.();
    document.querySelector('[data-action="notifications-open"]')?.focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', event => {
    const dialog = document.querySelector('#notification-dialog');
    if (opened && dialog?.open && !dialog.contains(event.target) && !event.target.closest?.('[data-action="notifications-open"]')) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && opened) { event.preventDefault(); close(); }
  });
  return {
    bell,
    shell: () => '<dialog id="notification-dialog" class="notification-panel" aria-labelledby="notification-title"></dialog>',
    mount() {
      if (currentAccount !== account()) {
        currentAccount = account();
        opened = false;
        toasts.forEach(item => clearTimeout(timers.get(item.id)));
        timers.clear();
        lifetimes.clear();
        toasts = [];
      }
      const dialog = document.querySelector('#notification-dialog');
      if (dialog && !dialog.dataset.bound) {
        dialog.dataset.bound = 'true';
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        dialog.addEventListener('click', event => {
          const bounds = dialog.getBoundingClientRect();
          if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) close();
        });
      }
      refresh();
    },
    notify(message, { level = 'info', key, transient = true, account: targetAccount = account() } = {}) {
      if (!retainNotification(key) && toasts.some(item => item.account === targetAccount && item.level === level && item.message === (level === 'error' ? userMessage(message) : String(message)))) return;
      const item = retainNotification(key) ? store.add(targetAccount, message, { level, key }) : { id: `temporary-${Date.now()}-${++transientSerial}`, account: targetAccount, level, message: level === 'error' ? userMessage(message) : String(message) };
      if (!item) return;
      if (transient && targetAccount === account() && !document.hidden) {
        toasts.push(item);
        while (toasts.length > 3) dismiss(toasts[0].id);
        resume(item.id);
      }
      refresh();
    },
    syncMail(count, targetAccount = account()) {
      store.reconcile(targetAccount, count > 0 ? `${count} new email${count === 1 ? '' : 's'} found in your mailbox.` : null, { key: 'mail:current', prefix: 'mail:' });
      refresh();
    },
    handle(action, element) {
      if (action === 'notifications-open') { if (opened) close(); else { opened = true; refresh(); } return true; }
      if (action === 'notifications-close') { close(); return true; }
      if (action === 'notifications-read-all') { store.markRead(account()); refresh(); return true; }
      if (action === 'notification-read') { store.markRead(account(), element.dataset.id); refresh(); return true; }
      if (action === 'notifications-clear') { store.clear(account()); toasts.forEach(item => clearTimeout(timers.get(item.id))); timers.clear(); lifetimes.clear(); toasts = []; refresh(); return true; }
      if (action === 'toast-dismiss') { dismiss(element.dataset.id); return true; }
      return false;
    },
    clearAccount(targetAccount) {
      store.clear(targetAccount);
      toasts.filter(item => item.account === targetAccount).forEach(item => dismiss(item.id));
      refresh();
    },
    pause,
    resume,
  };
}
