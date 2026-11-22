import { providerForHost } from './mail-providers.js';
import gmailIcon from './assets/providers/gmail.svg';
import outlookIcon from './assets/providers/outlook.svg';
import zohoIcon from './assets/providers/zoho.svg';
import icloudIcon from './assets/providers/icloud.svg';
import serverIcon from './assets/providers/mail-server.svg';

const providers = [
  { value: 'google', label: 'Gmail', icon: gmailIcon },
  { value: 'outlook', label: 'Outlook', icon: outlookIcon, disabled: true },
  { value: 'zoho', label: 'Zoho', icon: zohoIcon },
  { value: 'icloud', label: 'iCloud', icon: icloudIcon },
  { value: 'other', label: 'Others', icon: serverIcon },
];
const content = (provider, escape) => `<img class="mail-provider-icon" src="${provider.icon}" width="24" height="24" alt=""><span class="mail-provider-name">${escape(provider.label)}</span>${provider.disabled ? '<span class="mail-provider-soon">Coming soon</span>' : ''}`;

export function mailProviderPicker(host, disabled, escape) {
  const selected = providerForHost(host);
  const current = providers.find(provider => provider.value === selected);
  return `<label id="mail-provider-label" for="mail-provider-trigger">Email provider</label>
    <div class="mail-provider-picker">
      <select id="mail-provider" hidden aria-hidden="true" tabindex="-1" ${disabled ? 'disabled' : ''}>${providers.map(provider => `<option value="${provider.value}" ${provider.disabled ? 'disabled' : ''} ${provider.value === selected ? 'selected' : ''}>${escape(provider.label)}${provider.disabled ? ' (Coming soon)' : ''}</option>`).join('')}</select>
      <button id="mail-provider-trigger" class="mail-provider-trigger" data-value="${selected}" type="button" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="mail-provider-list" aria-labelledby="mail-provider-label" ${disabled ? 'disabled' : ''}>
        <span class="mail-provider-value">${content(current, escape)}</span><svg class="mail-provider-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>
      </button>
      <div id="mail-provider-list" class="mail-provider-list" role="listbox" aria-labelledby="mail-provider-label" hidden>${providers.map(provider => `<div id="mail-provider-option-${provider.value}" class="mail-provider-option" role="option" data-provider="${provider.value}" aria-selected="${provider.value === selected}" ${provider.disabled ? 'aria-disabled="true"' : ''}>${content(provider, escape)}<svg class="mail-provider-check" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg></div>`).join('')}</div>
    </div>`;
}

export function syncMailProviderPicker(root) {
  const select = root.querySelector('#mail-provider'), trigger = root.querySelector('#mail-provider-trigger');
  if (!select || !trigger) return;
  const option = root.querySelector(`#mail-provider-option-${select.value}`);
  if (!option) return;
  if (trigger.dataset.value !== select.value || select.disabled) {
    root.querySelector('#mail-provider-list').hidden = true;
    trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-activedescendant');
  }
  trigger.dataset.value = select.value;
  const value = trigger.querySelector('.mail-provider-value');
  // Copy trusted, locally rendered provider content; never inject a server name.
  value.replaceChildren(...[...option.children].filter(child => !child.classList.contains('mail-provider-check')).map(child => child.cloneNode(true)));
  trigger.disabled = select.disabled;
  root.querySelectorAll('[data-provider]').forEach(item => item.setAttribute('aria-selected', String(item === option)));
}

export function installMailProviderPicker(root) {
  let active = '', typed = '', typedAt = 0;
  const elements = () => ({ trigger: root.querySelector('#mail-provider-trigger'), list: root.querySelector('#mail-provider-list'), select: root.querySelector('#mail-provider') });
  const options = () => [...root.querySelectorAll('.mail-provider-option:not([aria-disabled="true"])')];
  const highlight = value => {
    const { trigger, list } = elements();
    active = value;
    const option = list.querySelector(`[data-provider="${value}"]`);
    list.querySelectorAll('[data-provider]').forEach(item => item.classList.toggle('provider-active', item === option));
    trigger.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  };
  const close = () => {
    const { trigger, list } = elements();
    if (!list || list.hidden) return;
    list.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-activedescendant');
    typed = ''; syncMailProviderPicker(root);
  };
  const open = () => {
    const { trigger, list, select } = elements();
    if (!trigger || trigger.disabled) return;
    if (list.hidden) {
      list.hidden = false; trigger.setAttribute('aria-expanded', 'true');
      highlight(options().some(option => option.dataset.provider === select.value) ? select.value : options()[0].dataset.provider);
    }
  };
  const choose = value => {
    const { trigger, select } = elements();
    if (!trigger || trigger.disabled || !options().some(option => option.dataset.provider === value)) return;
    const changed = select.value !== value;
    select.value = value; close(); syncMailProviderPicker(root);
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  root.addEventListener('click', event => {
    const { trigger, list } = elements();
    if (event.target.closest('#mail-provider-trigger')) {
      if (!trigger.disabled) { if (list.hidden) open(); else close(); }
    } else if (event.target.closest('.mail-provider-option')) {
      const option = event.target.closest('.mail-provider-option');
      choose(option.dataset.provider); trigger.focus({ preventScroll: true });
    }
  });
  root.addEventListener('pointerdown', event => { if (event.target.closest('.mail-provider-option')) event.preventDefault(); });
  root.ownerDocument.addEventListener('pointerdown', event => { if (!event.target.closest('.mail-provider-picker')) close(); });
  root.addEventListener('keydown', event => {
    if (event.target.id !== 'mail-provider-trigger') return;
    const { trigger, list } = elements();
    if (trigger.disabled) return;
    if (event.key === 'Escape' && !list.hidden) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { if (!list.hidden) choose(active); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); if (list.hidden) open(); else choose(active); return;
    }
    if (event.key === 'ArrowUp' && event.altKey && !list.hidden) { event.preventDefault(); choose(active); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      event.preventDefault();
      const wasClosed = list.hidden; open();
      const available = options(), index = available.findIndex(option => option.dataset.provider === active);
      const next = event.key === 'Home' || event.key === 'PageUp' ? 0 : event.key === 'End' || event.key === 'PageDown' ? available.length - 1
        : wasClosed ? index : Math.max(0, Math.min(available.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      highlight(available[next].dataset.provider); return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); open();
      typed = Date.now() - typedAt > 700 ? event.key.toLowerCase() : typed + event.key.toLowerCase(); typedAt = Date.now();
      const available = options();
      const query = [...typed].every(char => char === typed[0]) ? typed[0] : typed;
      const index = available.findIndex(option => option.dataset.provider === active);
      const ordered = query.length === 1 ? [...available.slice(index + 1), ...available.slice(0, index + 1)] : available;
      const match = ordered.find(option => providers.find(provider => provider.value === option.dataset.provider).label.toLowerCase().startsWith(query));
      if (match) highlight(match.dataset.provider);
    }
  });
  root.addEventListener('focusout', event => {
    if (event.target.id === 'mail-provider-trigger') close();
  });
  root.addEventListener('close', event => { if (event.target.id === 'mailbox-dialog') close(); }, true);
  root.addEventListener('change', event => { if (event.target.id === 'mail-provider') syncMailProviderPicker(root); });
}
