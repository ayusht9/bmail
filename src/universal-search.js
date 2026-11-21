import { userMessage } from './errors.js';
import { mailSearchFilters, readMailSearchFilters } from './mail-search-filters.js';

export const searchDestinations = [
  ['Theme', 'Light, dark, automatic appearance', 'preferences', '#theme-preference'],
  ['Font', 'Appearance, typeface, text style', 'preferences', '#font-family-preference'],
  ['Font size', 'Reading, text size', 'preferences', '#font-size-preference'],
  ['Email images', 'Privacy, embedded and remote images', 'preferences', '#email-image-preference'],
  ['Window behavior', 'Close, quit, system tray', 'preferences', '#close-behavior'],
  ['Google Drive', 'Cloud backup, connect, upload, automatic sync', 'preferences', '#cloud-backup-settings'],
  ['Dropbox', 'Cloud backup, connect, upload, automatic sync', 'preferences', '#dropbox-backup-settings'],
  ['Scheduled backup settings', 'Battery, power, network, recovery, restart, run limits', 'preferences', '#schedule-preferences-form'],
  ['Home', 'Browse mail, folders, read messages', 'mailbox'],
  ['Backup', 'Back up email, filters, download options', 'options'],
  ['Scheduler', 'Automatic backups, calendar, recurrence', 'scheduler'],
  ['Activity', 'History, backup results, notifications', 'activity'],
  ['Preferences', 'Appearance, reading, window and backup settings', 'preferences'],
  ['Account settings', 'Mailbox, IMAP, password, sign in', 'setup'],
];

export function matchDestinations(query, filter) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return searchDestinations.filter(item => (filter === 'all' || filter === (item[3] ? 'settings' : 'features')) && terms.every(term => item.join(' ').toLocaleLowerCase().includes(term)));
}

export function createUniversalSearch({ invoke, escape, navigate, openMail, account, unavailable, folders = () => [] }) {
  let dialog, timer, generation = 0, filter = 'all', results = [], mailPage = 1;
  const icon = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>';
  function close() { clearTimeout(timer); generation++; dialog?.close(); }
  async function search() {
    const request = ++generation;
    const query = dialog.querySelector('#universal-search-input').value.trim();
    const currentAccount = account();
    const target = dialog.querySelector('.universal-search-results');
    target.inert = false;
    target.setAttribute('aria-busy', 'false');
    const mailFilters = readMailSearchFilters(dialog);
    dialog.querySelector('[data-filter-count]').textContent = mailFilters.count ? `(${mailFilters.count})` : '';
    const destinations = filter === 'mails' ? [] : matchDestinations(query, filter);
    results = destinations.map(item => ({ title: item[0], detail: item[1], kind: item[3] ? 'Setting' : 'Feature', destination: item }));
    const draw = (note = '', pagination = '') => {
      target.innerHTML = results.map((item, index) => `<button type="button" class="universal-search-result" data-result="${index}"><span><strong>${escape(item.title)}</strong><small>${escape(item.detail)}</small></span><span class="search-kind">${item.kind}</span></button>`).join('') + (note ? `<p class="search-message" role="status">${escape(note)}</p>` : '') + pagination;
    };
    const includeMail = (query || filter === 'mails' || mailFilters.count) && ['all', 'mails'].includes(filter);
    if (includeMail && mailFilters.error) { draw(mailFilters.error); return; }
    if (includeMail) target.setAttribute('aria-busy', 'true');
    draw(includeMail ? 'Searching indexed mail…' : query && !results.length ? 'No matches. Try another word or filter.' : !query ? 'Search mail by subject, sender, or folder. Mail results use the current account’s index.' : '');
    if (!includeMail) return;
    try {
      const mail = await invoke('get_mail_page', { folder: mailFilters.folder, filters: mailFilters.filters, query, page: mailPage, pageSize: 25, sortColumn: 'sentAt', sortDirection: 'desc' });
      if (request !== generation || !dialog.open || currentAccount !== account()) return;
      target.setAttribute('aria-busy', 'false');
      results.push(...mail.rows.map(row => ({ title: row.subject || 'No subject', detail: `${row.sender || 'Unknown sender'} · ${row.folder || 'Mail'}`, kind: 'Mail', mail: row })));
      draw(!results.length ? 'No matches. Try another word or filter.' : `${mail.total} matching message${mail.total === 1 ? '' : 's'}`, mail.pages > 1 ? `<div class="search-pagination"><button type="button" data-page="${mail.page - 1}" ${mail.page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${mail.page} of ${mail.pages}</span><button type="button" data-page="${mail.page + 1}" ${mail.page >= mail.pages ? 'disabled' : ''}>Next</button></div>` : '');
    } catch (error) { if (request === generation && dialog.open) { target.setAttribute('aria-busy', 'false'); draw(userMessage(error)); } }
  }
  function open() {
    if (document.querySelector('dialog[open]')) return;
    dialog?.remove();
    dialog = document.createElement('dialog');
    dialog.className = 'universal-search';
    dialog.setAttribute('aria-labelledby', 'universal-search-title');
    dialog.innerHTML = `<header><h2 id="universal-search-title">Search Bmail</h2><button type="button" data-close aria-label="Close search"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></header><div class="universal-search-field">${icon}<label class="sr-only" for="universal-search-input">Search mail, settings, and features</label><input id="universal-search-input" type="search" placeholder="Search mail, settings, and features…" autocomplete="off" autofocus></div><div class="search-filters" role="group" aria-label="Search filters">${[['all', 'All'], ['mails', 'Mails'], ['settings', 'Settings'], ['features', 'Features']].map(([value, label]) => `<button type="button" data-filter="${value}" aria-pressed="${value === 'all'}">${label}</button>`).join('')}</div>${mailSearchFilters(folders(), escape)}<div class="universal-search-results" aria-label="Search results" aria-busy="false"></div>`;
    document.body.append(dialog);
    const owner = dialog;
    const ownerAccount = account();
    // Sender choices cover the full account index, independently of current filters.
    void invoke('get_mail_page', { page: 1, pageSize: 25, includeSenders: true }).then(result => {
      if (dialog !== owner || !owner.open || account() !== ownerAccount) return;
      owner.querySelector('#mail-sender-options').innerHTML = (result.senders || []).map(sender => `<option value="${escape(sender)}"></option>`).join('');
    }).catch(() => { /* Typing a sender remains available if suggestions cannot load. */ });
    filter = 'all'; mailPage = 1;
    function selectFilter(value) {
      filter = value;
      dialog.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.filter === value)));
      dialog.querySelector('.mail-search-filters').hidden = !['all', 'mails'].includes(value);
    }
    function scheduleSearch(event) {
      if (event.target.matches('input[type="date"]')) event.target.dataset.empty = String(!event.target.value);
      clearTimeout(timer); generation++; mailPage = 1;
      if (event.target.closest('.mail-search-filters')) selectFilter('mails');
      const target = dialog.querySelector('.universal-search-results');
      results = [];
      target.inert = true;
      target.setAttribute('aria-busy', 'true');
      timer = setTimeout(search, 180);
    }
    dialog.addEventListener('input', scheduleSearch);
    dialog.addEventListener('change', event => {
      if (event.target.matches('select, input[type="date"]')) scheduleSearch(event);
    });
    dialog.addEventListener('close', () => { clearTimeout(timer); generation++; });
    dialog.addEventListener('click', async event => {
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      if (button.hasAttribute('data-close')) { close(); return; }
      if (button.hasAttribute('data-clear-mail-filters')) {
        clearTimeout(timer);
        dialog.querySelectorAll('.mail-search-filters input, .mail-search-filters select').forEach(control => { control.value = ''; if (control.type === 'date') control.dataset.empty = 'true'; });
        selectFilter('mails'); mailPage = 1; void search(); return;
      }
      if (button.dataset.filter) {
        clearTimeout(timer); selectFilter(button.dataset.filter); mailPage = 1;
        void search(); return;
      }
      if (button.dataset.page) { mailPage = Number(button.dataset.page); void search(); return; }
      if (button.dataset.result === undefined) return;
      if (unavailable()) { dialog.querySelector('.search-message')?.remove(); dialog.querySelector('.universal-search-results').insertAdjacentHTML('beforeend', '<p class="search-message" role="status">Wait for the current operation to finish, then open this result.</p>'); return; }
      const result = results[Number(button.dataset.result)];
      if (!result) return;
      close();
      if (result.mail) await openMail(result.mail);
      else await navigate(result.destination[2], result.destination[3]);
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key === 'Enter' && event.target.id === 'universal-search-input') {
        event.preventDefault(); dialog.querySelector('[data-result]')?.click(); return;
      }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.target.closest('.mail-search-filters')) return;
      const buttons = [...dialog.querySelectorAll('[data-result]')];
      if (!buttons.length) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement);
      buttons[index < 0 ? event.key === 'ArrowDown' ? 0 : buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    });
    dialog.showModal(); void search();
  }
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (dialog?.open) dialog.querySelector('input').focus(); else open(); }
  });
  return { open };
}
