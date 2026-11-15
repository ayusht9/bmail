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

export function coverageRows(dashboard, escape, number) {
  const local = new Map();
  for (const folder of dashboard.localStats?.folders || []) local.set(folder.name, (local.get(folder.name) || 0) + folder.messages);
  const server = new Map((dashboard.mailboxStatus?.folders || []).map(folder => [folder.name, folder]));
  const names = [...new Set([...local.keys(), ...server.keys()])].sort();
  return names.map(name => `<tr><td>${escape(name)}</td><td>${number(local.get(name) || 0)}</td><td>${server.has(name) ? number(server.get(name).serverMessages) : 'Not checked'}</td><td>${server.has(name) ? number(server.get(name).missingMessages) : 'Not checked'}</td></tr>`).join('');
}

export function statisticsPanel(dashboard, escape, number, date, busy) {
  const local = dashboard.localStats || { messages: dashboard.totalMessages || 0, bytes: 0, recent: [] };
  const snapshot = dashboard.mailboxStatus;
  const coverage = backupCoverage(dashboard);
  const percent = snapshot ? (snapshot.totalServerMessages ? Math.floor(snapshot.savedMessages / snapshot.totalServerMessages * 100) : 100) : null;
  const recent = (local.recent || []).map(message => `<li><div><strong>${escape(message.subject || 'No subject')}</strong><small>${escape(message.sender || 'Unknown sender')} · ${escape(message.folder)}</small></div><time>${date(message.backedUpAt)}</time></li>`).join('');
  return `<section class="backup-statistics" aria-label="Backup statistics">
    <div class="stats-heading"><div><p class="eyebrow">Backup overview</p><h2>${coverage.title}</h2>
      <p>${snapshot ? `Mailbox checked ${date(snapshot.checkedAt)}. Mail arriving during or after the check may not be included.` : 'Check your mailbox to compare all server folders with your saved files.'}</p></div>
      <button class="ghost" data-action="stats" ${busy || dashboard.backupRunning || !dashboard.credentialReady ? 'disabled' : ''}>${busy ? 'Working...' : 'Check mailbox'}</button></div>
    ${percent !== null ? `<div class="coverage-meter"><progress max="100" value="${percent}" aria-label="Mailbox coverage at last check">${percent}%</progress><span>${percent}% · ${number(snapshot.savedMessages)} / ${number(snapshot.totalServerMessages)} server messages saved</span></div>` : ''}
    <div class="metrics stats-grid">
      <article><span>Saved messages</span><strong>${number(local.messages)}</strong><small>Recorded locally; verified by Check mailbox</small></article>
      <article><span>Backup size</span><strong>${formatBytes(local.bytes)}</strong><small>Email bytes recorded in the manifest</small></article>
      <article><span>Still to back up</span><strong>${snapshot ? number(snapshot.missingMessages) : 'Not checked'}</strong><small>Missing or damaged at last mailbox check</small></article>
      <article><span>New on server</span><strong>${snapshot?.newMessages != null ? number(snapshot.newMessages) : 'Not checked'}</strong><small>${snapshot?.previousCheckedAt ? `Added since ${date(snapshot.previousCheckedAt)}` : 'Available after two mailbox checks'}</small></article>
      <article><span>Downloaded last run</span><strong>${number(dashboard.lastRun?.downloaded)}</strong><small>${dashboard.lastRun?.finishedAt ? date(dashboard.lastRun.finishedAt) : 'No completed run yet'}</small></article>
      <article><span>Last full backup confirmed</span><strong class="stat-date">${snapshot?.lastFullBackupAt ? date(snapshot.lastFullBackupAt) : 'Not confirmed'}</strong><small>All accessible folders and dates checked</small></article>
    </div>
    <p class="stats-note">${number(dashboard.folderCount)} local folder generations · Schedule: ${dashboard.scheduleInstalled ? 'Monday, 11:00' : 'not installed'}. Folder/date selections and message limits may leave the full mailbox incomplete. Gmail labels can store the same email in multiple folders; counts include each folder copy.</p>
    ${recent ? `<details class="recent-mail"><summary>Recently saved mail</summary><ul>${recent}</ul></details>` : ''}
  </section>`;
}
