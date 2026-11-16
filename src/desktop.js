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

export function recentMailPane(dashboard, selected, escape, date) {
  const messages = (dashboard.localStats?.recent || []).filter(message => !selected || message.folder === selected);
  const rows = messages.map(message => `<tr><td>${escape(message.subject || 'No subject')}</td><td>${escape(message.sender || 'Unknown sender')}</td><td>${escape(message.folder)}</td><td>${date(message.backedUpAt)}</td><td>${downloadButton('download-email', `data-file="${escape(message.file || '')}"`, `Download ${message.subject || 'email'} (.eml)`, escape, !message.file)}</td></tr>`).join('');
  return `<section class="mail-pane" aria-label="Recently saved mail"><div class="pane-title"><h2>Recently saved mail</h2><span>Latest saved records${selected ? ` in ${escape(selected)}` : ''}</span></div>
    ${rows ? `<div class="table-wrap"><table class="mail-table"><thead><tr><th>Subject</th><th>From</th><th>Folder</th><th>Saved</th><th><span class="sr-only">Download</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty-pane">No recent saved records for this folder.</p>'}
    <p class="pane-hint">Shows the latest 10 saved records for this account. Download individual emails as .eml files or a folder as a ZIP from Folder coverage.</p></section>`;
}
