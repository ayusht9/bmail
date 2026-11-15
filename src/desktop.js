export function mailboxFolders(dashboard) {
  return [...new Set([...(dashboard.localStats?.folders || []).map(folder => folder.name),
    ...(dashboard.mailboxStatus?.folders || []).map(folder => folder.name), ...(dashboard.mailboxes?.folders || [])])].sort();
}

export function folderNavigation(dashboard, selected, filter, escape, number) {
  const counts = new Map();
  for (const folder of dashboard.localStats?.folders || []) counts.set(folder.name, (counts.get(folder.name) || 0) + folder.messages);
  return mailboxFolders(dashboard).filter(name => name.toLowerCase().includes(filter.toLowerCase())).map(name =>
    `<button class="folder-item ${selected === name ? 'selected' : ''}" data-action="select-folder" data-folder="${escape(name)}" aria-pressed="${selected === name}"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M2 5h6l2 2h8v9H2z"/></svg><span>${escape(name)}</span><small>${number(counts.get(name) || 0)}</small></button>`).join('');
}

export function recentMailPane(dashboard, selected, escape, date) {
  const messages = (dashboard.localStats?.recent || []).filter(message => !selected || message.folder === selected);
  const rows = messages.map(message => `<tr><td>${escape(message.subject || 'No subject')}</td><td>${escape(message.sender || 'Unknown sender')}</td><td>${escape(message.folder)}</td><td>${date(message.backedUpAt)}</td></tr>`).join('');
  return `<section class="mail-pane" aria-label="Recently saved mail"><div class="pane-title"><h2>Recently saved mail</h2><span>Latest saved records${selected ? ` in ${escape(selected)}` : ''}</span></div>
    ${rows ? `<div class="table-wrap"><table class="mail-table"><thead><tr><th>Subject</th><th>From</th><th>Folder</th><th>Saved</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty-pane">No recent saved records for this folder.</p>'}
    <p class="pane-hint">Shows the latest 10 saved records for this account. Open the backup folder to access email files.</p></section>`;
}
