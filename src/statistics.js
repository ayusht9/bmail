import { downloadButton } from './desktop.js';
import { newMailBadge } from './notifications.js';

export function backupCoverage(dashboard) {
  const snapshot = dashboard.mailboxStatus;
  if (dashboard.backupRunning) return { title: 'Backup in progress', complete: false };
  if (!snapshot) return { title: 'Full backup not checked yet', complete: false };
  return { title: snapshot.complete ? 'Full mailbox backed up at last check' : 'Mailbox backup is incomplete', complete: snapshot.complete };
}

export function formatBytes(value = 0) {
  if (value < 1024) return `${value} B`;
  const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}

export function coverageRows(dashboard, escape, number, selected = '', filter = '', newMail = new Map()) {
  const local = new Map();
  for (const folder of dashboard.localStats?.folders || []) local.set(folder.name, (local.get(folder.name) || 0) + folder.messages);
  const server = new Map((dashboard.mailboxStatus?.folders || []).map(folder => [folder.name, folder]));
  const names = [...new Set([...local.keys(), ...server.keys(), ...(dashboard.mailboxes?.folders || []), ...(dashboard.newMailFolders || [])])].sort()
    .filter(name => (!selected || name === selected) && name.toLowerCase().includes(filter.toLowerCase()));
  return names.map(name => `<tr class="${selected === name ? 'selected' : ''}"><td><button data-action="select-folder" data-folder="${escape(name)}" title="${escape(name)}">${escape(name)}</button>${newMailBadge(newMail.get(name), escape, name)}</td><td>${number(local.get(name) || 0)}</td><td>${server.has(name) ? number(server.get(name).serverMessages) : dashboard.mailboxStatus ? 'Not on server' : 'Not checked'}</td><td class="row-actions"><span>${server.has(name) ? number(server.get(name).missingMessages) : dashboard.mailboxStatus ? '—' : 'Not checked'}</span>${downloadButton('download-folder', `data-folder="${escape(name)}"`, `Download ${name} (.zip)`, escape, !local.get(name))}</td></tr>`).join('');
}

export function statisticsPanel(dashboard, escape, number, date) {
  const local = dashboard.localStats || { messages: dashboard.totalMessages || 0, bytes: 0 };
  const snapshot = dashboard.mailboxStatus;
  const coverage = backupCoverage(dashboard);
  const percent = snapshot ? (snapshot.totalServerMessages ? Math.floor(snapshot.savedMessages / snapshot.totalServerMessages * 100) : 100) : null;
  return `<section class="backup-statistics" aria-label="Backup statistics">
    <div class="pane-title"><h2>Account overview</h2></div>
    <div class="coverage-status ${coverage.complete ? 'complete' : ''}"><h3>${coverage.title}</h3>
      ${percent !== null ? `<progress max="100" value="${percent}" aria-label="Mailbox coverage at last check">${percent}%</progress><p>${percent}% covered (${number(snapshot.savedMessages)} of ${number(snapshot.totalServerMessages)})</p>` : '<p>Use Check mailbox to compare server mail with saved files.</p>'}</div>
    <dl class="stats-list">
      <div><dt>Saved messages</dt><dd>${number(local.messages)}</dd></div>
      <div><dt>Backup size</dt><dd>${formatBytes(local.bytes)}</dd></div>
      <div><dt>Still to back up</dt><dd>${snapshot ? number(snapshot.missingMessages) : 'Not checked'}</dd></div>
      <div><dt>New on server</dt><dd>${snapshot?.newMessages != null ? number(snapshot.newMessages) : 'Not checked'}</dd></div>
      <div><dt>Downloaded last run</dt><dd>${number(dashboard.lastRun?.downloaded)}</dd></div>
    </dl>
    <dl class="check-dates"><div><dt>Mailbox checked</dt><dd>${snapshot ? date(snapshot.checkedAt) : 'Not checked'}</dd></div>
      <div><dt>Last full backup confirmed</dt><dd>${snapshot?.lastFullBackupAt ? date(snapshot.lastFullBackupAt) : 'Not confirmed'}</dd></div>
      <div><dt>New mail compared with</dt><dd>${snapshot?.previousCheckedAt ? date(snapshot.previousCheckedAt) : 'Requires two checks'}</dd></div></dl>
  </section>`;
}
