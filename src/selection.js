export function selectionSummary(options = {}) {
  const folders = options.folders?.length ? options.folders.length === 1 ? options.folders[0] : `${options.folders.length} folders` : 'All folders';
  const dates = options.dateFrom || options.dateTo ? `${options.dateFrom || 'Beginning'} to ${options.dateTo || 'Today'}` : 'Any date';
  const filters = options.advanced;
  const range = filters?.lastDays ? `Last ${filters.lastDays} days` : dates;
  const extras = [filters?.unreadOnly && 'Unread', filters?.flaggedOnly && 'Starred', filters?.sender && 'Sender filter', filters?.subject && 'Subject filter'].filter(Boolean);
  return `${folders} · ${range} · ${options.maxMessages ? `Up to ${options.maxMessages.toLocaleString('en-IN')} new emails per run` : 'No message limit'}${extras.length ? ` · ${extras.join(', ')}` : ''}`;
}

export function advancedFromForm(values) {
  const number = name => values.get(name) ? Number(values.get(name)) : null;
  return { excludedFolders: String(values.get('excludedFolders') || '').split('\n').map(value => value.trim()).filter(Boolean),
    lastDays: number('lastDays'), unreadOnly: values.has('unreadOnly'), flaggedOnly: values.has('flaggedOnly'),
    sender: String(values.get('sender') || '').trim(), subject: String(values.get('subject') || '').trim(),
    minSizeKB: number('minSizeKB'), maxSizeMB: number('maxSizeMB'), order: values.get('order'),
    retryAttempts: number('retryAttempts'), retryDelaySeconds: number('retryDelaySeconds'),
    connectionTimeoutSeconds: number('connectionTimeoutSeconds'), socketTimeoutSeconds: number('socketTimeoutSeconds'),
    verifyAfterBackup: values.has('verifyAfterBackup'), checkMailboxAfterBackup: values.has('checkMailboxAfterBackup'),
    notifyOnSuccess: values.has('notifyOnSuccess'), notifyOnFailure: values.has('notifyOnFailure'), notifyOnStopped: values.has('notifyOnStopped') };
}

export function folderChoices(names, selected, disabled, escapeHtml) {
  const all = [...new Set([...names, ...selected])];
  return `<fieldset id="folder-choices" ${disabled ? 'disabled' : ''}><legend>Mailbox folders</legend>${all.length
    ? all.map(name => `<label class="folder-choice"><input type="checkbox" name="folders" value="${escapeHtml(name)}" ${selected.includes(name) ? 'checked' : ''}><span>${escapeHtml(name)}</span></label>`).join('')
    : '<p class="muted">Load your mailbox folders to choose individual folders.</p>'}</fieldset>`;
}

export function backupOptionsView(dashboard, escapeHtml, draft = null) {
  const options = draft || dashboard.backupOptions || {};
  const selected = options.folders || [];
  const allFolders = options._uiAllFolders ?? !selected.length;
  const a = { excludedFolders: [], lastDays: null, unreadOnly: false, flaggedOnly: false, sender: '', subject: '',
    minSizeKB: null, maxSizeMB: null, order: 'newest', retryAttempts: 3, retryDelaySeconds: 30,
    connectionTimeoutSeconds: 30, socketTimeoutSeconds: 300, verifyAfterBackup: true, checkMailboxAfterBackup: true,
    notifyOnSuccess: false, notifyOnFailure: false, notifyOnStopped: false, ...options.advanced };
  return `<section id="selection-panel" class="backup-options-page" aria-labelledby="selection-title">
    <form id="selection-form"><h2 id="selection-title">Choose what to back up</h2>
      <p>Folder choices apply to manual backups. Scheduler has its own folder selection; other filters and limits apply to both.</p>
      <div class="backup-presets" aria-label="Backup presets"><button type="button" data-action="backup-preset" data-preset="full">Full mailbox</button><button type="button" data-action="backup-preset" data-preset="recent">Last 30 days</button><button type="button" data-action="backup-preset" data-preset="custom">Custom folders</button></div>
      <label class="folder-choice"><input id="all-folders" name="allFolders" type="checkbox" ${allFolders ? 'checked' : ''}><span>All available folders</span></label>
      <button type="button" class="ghost" data-action="load-folders">Load / refresh mailbox folders</button>
      <div id="folder-options">${folderChoices(dashboard.mailboxes?.folders || [], selected, allFolders, escapeHtml)}</div>
      <p class="muted">Gmail can expose the same email under several labels. Selecting overlapping folders saves separate copies.</p>
      <div class="date-fields"><div><label for="date-from">Received from</label><input id="date-from" name="dateFrom" type="date" value="${escapeHtml(options.dateFrom || '')}"></div><div><label for="date-to">Received through</label><input id="date-to" name="dateTo" type="date" value="${escapeHtml(options.dateTo || '')}"></div></div>
      <p class="muted">Both dates are inclusive, using the date your mail server received each message.</p>
      <label for="max-messages">Maximum new emails per run</label><input id="max-messages" name="maxMessages" type="number" min="1" max="1000000" placeholder="No limit" value="${options.maxMessages || ''}">
      <p class="muted">Already saved emails do not count toward this limit. Start another run to continue with the remaining matching email.</p>
      <details class="advanced-backup" ${options._uiAdvancedOpen ? 'open' : ''}><summary>Advanced backup options</summary>
        <h3>Message filters</h3>
        <label for="excluded-folders">Excluded folders (one exact folder name per line)</label><textarea id="excluded-folders" name="excludedFolders" rows="3">${escapeHtml(a.excludedFolders.join('\n'))}</textarea>
        <label for="last-days">Rolling window: last N days</label><input id="last-days" name="lastDays" type="number" min="1" max="36500" value="${a.lastDays || ''}" placeholder="Use fixed dates above or leave empty">
        <p class="muted">Includes today, recalculated for each run using IMAP calendar dates. Clear fixed dates to use a rolling window.</p>
        <label class="folder-choice"><input type="checkbox" name="unreadOnly" ${a.unreadOnly ? 'checked' : ''}>Unread messages only</label>
        <label class="folder-choice"><input type="checkbox" name="flaggedOnly" ${a.flaggedOnly ? 'checked' : ''}>Starred / flagged messages only</label>
        <label for="sender-filter">Sender contains</label><input id="sender-filter" name="sender" maxlength="500" value="${escapeHtml(a.sender)}">
        <label for="subject-filter">Subject contains</label><input id="subject-filter" name="subject" maxlength="500" value="${escapeHtml(a.subject)}">
        <div class="date-fields"><div><label for="min-size">Minimum size (KB)</label><input id="min-size" name="minSizeKB" type="number" min="1" max="1048576" value="${a.minSizeKB || ''}" placeholder="No minimum"></div><div><label for="max-size">Maximum size (MB)</label><input id="max-size" name="maxSizeMB" type="number" min="1" max="1024" value="${a.maxSizeMB || ''}" placeholder="No maximum"></div></div>
        <p class="muted">Size filters use the size reported by your IMAP server.</p>
        <label for="download-order">Download order (server UID order)</label><select id="download-order" name="order"><option value="newest" ${a.order === 'newest' ? 'selected' : ''}>Newest first</option><option value="oldest" ${a.order === 'oldest' ? 'selected' : ''}>Oldest first</option></select>
        <h3>Connection and recovery</h3><div class="date-fields">
          <div><label for="retry-attempts">Connection attempts</label><input id="retry-attempts" name="retryAttempts" type="number" min="1" max="10" value="${a.retryAttempts}" required></div>
          <div><label for="retry-delay">Retry base delay (seconds)</label><input id="retry-delay" name="retryDelaySeconds" type="number" min="1" max="3600" value="${a.retryDelaySeconds}" required></div>
          <div><label for="connect-timeout">Connect timeout (seconds)</label><input id="connect-timeout" name="connectionTimeoutSeconds" type="number" min="5" max="120" value="${a.connectionTimeoutSeconds}" required></div>
          <div><label for="socket-timeout">Socket timeout (seconds)</label><input id="socket-timeout" name="socketTimeoutSeconds" type="number" min="30" max="1800" value="${a.socketTimeoutSeconds}" required></div></div>
        <p class="muted">Transient failures retry with an increasing delay. Incorrect credentials do not retry.</p>
        <h3>Verification</h3>
        <label class="folder-choice"><input type="checkbox" name="verifyAfterBackup" ${a.verifyAfterBackup ? 'checked' : ''}>Verify the entire retained archive after a backup</label>
        <label class="folder-choice"><input type="checkbox" name="checkMailboxAfterBackup" ${a.checkMailboxAfterBackup ? 'checked' : ''}>Refresh full-mailbox coverage after a successful backup</label>
        <p class="muted">New downloads are always verified. Disabling final checks saves time but leaves the full-mailbox confirmation at its previous check date. Existing files and server mail are never deleted.</p>
        <h3>Desktop notifications</h3>
        <label class="folder-choice"><input type="checkbox" name="notifyOnSuccess" ${a.notifyOnSuccess ? 'checked' : ''}>Notify when a backup completes</label>
        <label class="folder-choice"><input type="checkbox" name="notifyOnFailure" ${a.notifyOnFailure ? 'checked' : ''}>Notify when a backup fails</label>
        <label class="folder-choice"><input type="checkbox" name="notifyOnStopped" ${a.notifyOnStopped ? 'checked' : ''}>Notify when a backup is stopped or cancelled</label>
        <button type="button" data-action="test-notification">Send test notification</button>
        <p id="notification-status" role="status"></p>
        <p class="muted">Works for manual and scheduled backups while signed in. Windows notification and Do not disturb settings may suppress alerts. Backup history is always saved independently of notifications.</p>
      </details>
      <p id="selection-error" role="alert"></p>
      <div class="dialog-actions"><button type="button" class="ghost" data-action="reset-selection">Discard edits</button><button type="submit" class="primary" ${dashboard.backupRunning || !dashboard.credentialReady ? 'disabled' : ''}>Save selection</button></div>
    </form></section>`;
}
