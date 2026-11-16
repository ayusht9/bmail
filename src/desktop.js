import { tableStart, columnHandle } from './columns.js';

export function newMailDot(count, escape, folder = '') {
  if (!(count > 0)) return '';
  const label = `${count} new email${count === 1 ? '' : 's'}${folder ? ` in ${folder}` : ''} since the previous mailbox check`;
  return `<span class="new-mail-dot" role="img" aria-label="${escape(label)}" title="${escape(label)}"></span>`;
}

export function downloadButton(action, attributes, label, escape, disabled = false) {
  return `<button class="download-icon" data-action="${action}" ${attributes} title="${escape(label)}" aria-label="${escape(label)}" ${disabled ? 'disabled' : ''}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4"/></svg></button>`;
}

const folderCache = new WeakMap();
export function mailboxFolders(dashboard) {
  const sources = [dashboard.localStats?.folders, dashboard.mailboxStatus?.folders, dashboard.mailboxes?.folders, dashboard.newMailFolders];
  const cached = folderCache.get(dashboard);
  if (cached && sources.every((source, index) => source === cached.sources[index])) return cached.folders;
  const folders = [...new Set([...(dashboard.localStats?.folders || []).map(folder => folder.name),
    ...(dashboard.mailboxStatus?.folders || []).map(folder => folder.name), ...(dashboard.mailboxes?.folders || []), ...(dashboard.newMailFolders || [])])].sort();
  folderCache.set(dashboard, { sources, folders });
  return folders;
}

export function folderNavigation(dashboard, selected, filter, escape, number, newMail = new Map()) {
  const counts = new Map();
  for (const folder of dashboard.localStats?.folders || []) counts.set(folder.name, (counts.get(folder.name) || 0) + folder.messages);
  return mailboxFolders(dashboard).filter(name => name.toLowerCase().includes(filter.toLowerCase())).map(name =>
    `<div class="folder-row" data-folder="${escape(name)}"><button class="folder-item ${selected === name ? 'selected' : ''}" data-action="select-folder" data-folder="${escape(name)}" aria-pressed="${selected === name}"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M2 5h6l2 2h8v9H2z"/></svg><span>${escape(name)}</span><small>${number(counts.get(name) || 0)}</small></button>${newMailDot(newMail.get(name), escape, name)}${downloadButton('download-folder', `data-folder="${escape(name)}"`, `Download ${name} (.zip)`, escape, !counts.get(name))}</div>`).join('');
}

export function mailSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const mailCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
export function sortMail(messages, sort) {
  const direction = sort.direction === 'asc' ? 1 : -1;
  const value = message => sort.column === 'sentAt' ? Date.parse(message.sentAt) || 0 : sort.column === 'bytes' ? Number(message.bytes) || 0 : String(message[sort.column] || (sort.column === 'subject' ? 'No subject' : sort.column === 'sender' ? 'Unknown sender' : ''));
  return [...messages].sort((a, b) => {
    const result = ['sentAt', 'bytes'].includes(sort.column) ? value(a) - value(b) : mailCollator.compare(value(a), value(b));
    return direction * result;
  });
}

export function savedMailPane(state, selected, sort, escape, date, selectedFile = '') {
  const messages = sortMail(state.rows, sort);
  const headings = [['subject', 'Subject'], ['sender', 'From'], ['folder', 'Folder'], ['sentAt', 'Sent'], ['bytes', 'Size']];
  const header = headings.map(([key, label], index) => `<th ${sort.column === key ? `aria-sort="${sort.direction === 'asc' ? 'ascending' : 'descending'}"` : ''}><button type="button" data-action="sort-mail" data-column="${key}" title="Sort by ${label.toLowerCase()} ${sort.column === key && sort.direction === 'asc' ? 'descending' : 'ascending'}">${label}<span aria-hidden="true">${sort.column === key ? sort.direction === 'asc' ? '&#8593;' : '&#8595;' : '&#8597;'}</span></button>${columnHandle('mail', index, label)}</th>`).join('');
  const rows = messages.map(message => `<tr class="${message.backedUp ? 'backed-up' : ''} ${message.file === selectedFile ? 'selected' : ''}" data-action="select-message" data-file="${escape(message.file || '')}"><td><button class="mail-subject" data-action="select-message" data-file="${escape(message.file || '')}" title="${escape(message.subject || 'No subject')}">${escape(message.subject || 'No subject')}</button></td><td>${escape(message.sender || 'Unknown sender')}</td><td>${escape(message.folder)}</td><td>${message.sentAt ? date(message.sentAt) : 'Unknown'}</td><td class="row-actions"><span>${mailSize(message.bytes)}</span>${downloadButton('download-email', `data-file="${escape(message.file || '')}"`, `Download ${message.subject || 'email'} (.eml)`, escape, !message.file)}</td></tr>`).join('');
  return `<section class="mail-pane" aria-label="Saved mail" aria-busy="${state.loading}">
    ${state.loading ? '<p class="empty-pane">Loading saved emails...</p>' : state.error ? `<p class="empty-pane" role="alert">${escape(state.error)} <button data-action="retry-mail">Retry</button></p>` : rows ? `<div class="table-wrap">${tableStart('mail', 'mail-table')}<thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty-pane">No saved emails in this folder yet.</p>'}
</section>`;
}
