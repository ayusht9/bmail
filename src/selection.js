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
  return `<fieldset id="folder-choices" ${disabled ? 'disabled' : ''}><legend class="sr-only">Mailbox folders</legend>${all.length
    ? all.map(name => `<label class="folder-choice"><input type="checkbox" name="folders" value="${escapeHtml(name)}" ${selected.includes(name) ? 'checked' : ''}><span>${escapeHtml(name)}</span></label>`).join('')
    : '<p class="muted">No folders loaded.</p>'}</fieldset>`;
}

const DEFAULT_ADVANCED = { excludedFolders: [], lastDays: null, unreadOnly: false, flaggedOnly: false, sender: '', subject: '',
  minSizeKB: null, maxSizeMB: null, order: 'newest', retryAttempts: 3, retryDelaySeconds: 30,
  connectionTimeoutSeconds: 30, socketTimeoutSeconds: 300, verifyAfterBackup: true, checkMailboxAfterBackup: true,
  notifyOnSuccess: false, notifyOnFailure: false, notifyOnStopped: false };

export function activePreset(options, a, allFolders) {
  if (!allFolders) return 'custom';
  const filtered = options.dateFrom || options.dateTo || options.maxMessages || a.excludedFolders.length || a.unreadOnly || a.flaggedOnly
    || a.sender || a.subject || a.minSizeKB || a.maxSizeMB;
  if (filtered) return '';
  return a.lastDays === 30 ? 'recent' : a.lastDays ? '' : 'full';
}

export function backupOptionsView(dashboard, escapeHtml, draft = null) {
  const options = draft || dashboard.backupOptions || {};
  const selected = options.folders || [];
  const allFolders = options._uiAllFolders ?? !selected.length;
  const a = { ...DEFAULT_ADVANCED, ...options.advanced };
  const preset = activePreset(options, a, allFolders);
  const presetButton = (key, label) => `<button type="button" data-action="backup-preset" data-preset="${key}" aria-pressed="${preset === key}">${label}</button>`;
  const check = (name, label, checked) => `<label class="folder-choice"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>${label}</label>`;
  return `<section id="selection-panel" class="backup-options-page" aria-labelledby="selection-title">
    <form id="selection-form">
      <header class="backup-form-head">
        <div><h2 id="selection-title">Backup selection</h2><p class="backup-summary">${escapeHtml(selectionSummary({ ...options, folders: allFolders ? [] : selected, advanced: a }))}</p></div>
        <div class="backup-presets" role="group" aria-label="Backup presets">${presetButton('full', 'Full mailbox')}${presetButton('recent', 'Last 30 days')}${presetButton('custom', 'Custom folders')}</div>
      </header>
      <div class="backup-grid">
        <section class="backup-card backup-card-folders" aria-labelledby="backup-folders-title">
          <div class="backup-card-head"><h3 id="backup-folders-title">Folders</h3><button type="button" class="ghost" data-action="load-folders">Refresh folders</button></div>
          <label class="folder-choice"><input id="all-folders" name="allFolders" type="checkbox" ${allFolders ? 'checked' : ''}><span>All folders</span></label>
          <div id="folder-options">${folderChoices(dashboard.mailboxes?.folders || [], selected, allFolders, escapeHtml)}</div>
        </section>
        <section class="backup-card" aria-labelledby="backup-range-title">
          <h3 id="backup-range-title">Date range and limits</h3>
          <div class="date-fields">
            <div><label for="date-from">Received from</label><input id="date-from" name="dateFrom" type="date" value="${escapeHtml(options.dateFrom || '')}"></div>
            <div><label for="date-to">Received through</label><input id="date-to" name="dateTo" type="date" value="${escapeHtml(options.dateTo || '')}"></div>
            <div><label for="last-days">Or last N days</label><input id="last-days" name="lastDays" type="number" min="1" max="36500" value="${a.lastDays || ''}" placeholder="Off"></div>
            <div><label for="max-messages">New emails per run</label><input id="max-messages" name="maxMessages" type="number" min="1" max="1000000" placeholder="No limit" value="${options.maxMessages || ''}"></div>
            <div><label for="download-order">Download order</label><select id="download-order" name="order"><option value="newest" ${a.order === 'newest' ? 'selected' : ''}>Newest first</option><option value="oldest" ${a.order === 'oldest' ? 'selected' : ''}>Oldest first</option></select></div>
          </div>
        </section>
        <section class="backup-card" aria-labelledby="backup-filters-title">
          <h3 id="backup-filters-title">Filters</h3>
          <div class="backup-checks">${check('unreadOnly', 'Unread only', a.unreadOnly)}${check('flaggedOnly', 'Starred / flagged only', a.flaggedOnly)}</div>
          <div class="date-fields filter-fields">
            <div><label for="sender-filter">Sender contains</label><input id="sender-filter" name="sender" maxlength="500" value="${escapeHtml(a.sender)}"></div>
            <div><label for="subject-filter">Subject contains</label><input id="subject-filter" name="subject" maxlength="500" value="${escapeHtml(a.subject)}"></div>
            <div><label for="min-size">Minimum size (KB)</label><input id="min-size" name="minSizeKB" type="number" min="1" max="1048576" value="${a.minSizeKB || ''}" placeholder="No minimum"></div>
            <div><label for="max-size">Maximum size (MB)</label><input id="max-size" name="maxSizeMB" type="number" min="1" max="1024" value="${a.maxSizeMB || ''}" placeholder="No maximum"></div>
          </div>
          <label for="excluded-folders">Excluded folders</label><textarea id="excluded-folders" name="excludedFolders" rows="2" placeholder="One folder name per line">${escapeHtml(a.excludedFolders.join('\n'))}</textarea>
        </section>
        <section class="backup-card" aria-labelledby="backup-after-title">
          <h3 id="backup-after-title">After backup</h3>
          <div class="backup-checks">
            ${check('verifyAfterBackup', 'Verify all saved mail', a.verifyAfterBackup)}${check('checkMailboxAfterBackup', 'Refresh mailbox coverage', a.checkMailboxAfterBackup)}
            ${check('notifyOnSuccess', 'Notify on completion', a.notifyOnSuccess)}${check('notifyOnFailure', 'Notify on failure', a.notifyOnFailure)}${check('notifyOnStopped', 'Notify when stopped or cancelled', a.notifyOnStopped)}
          </div>
          <div class="backup-card-foot"><button type="button" class="ghost" data-action="test-notification">Send test notification</button><span id="notification-status" role="status"></span></div>
        </section>
      </div>
      <details class="advanced-backup backup-card" ${options._uiAdvancedOpen ? 'open' : ''}><summary>Connection settings</summary>
        <div class="date-fields connection-fields">
          <div><label for="retry-attempts">Connection attempts</label><input id="retry-attempts" name="retryAttempts" type="number" min="1" max="10" value="${a.retryAttempts}" required></div>
          <div><label for="retry-delay">Retry delay (seconds)</label><input id="retry-delay" name="retryDelaySeconds" type="number" min="1" max="3600" value="${a.retryDelaySeconds}" required></div>
          <div><label for="connect-timeout">Connect timeout (seconds)</label><input id="connect-timeout" name="connectionTimeoutSeconds" type="number" min="5" max="120" value="${a.connectionTimeoutSeconds}" required></div>
          <div><label for="socket-timeout">Socket timeout (seconds)</label><input id="socket-timeout" name="socketTimeoutSeconds" type="number" min="30" max="1800" value="${a.socketTimeoutSeconds}" required></div>
        </div>
      </details>
      <p id="selection-error" role="alert"></p>
      <div class="dialog-actions"><button type="button" class="ghost" data-action="reset-selection">Discard edits</button><button type="submit" class="primary" ${dashboard.backupRunning || !dashboard.credentialReady ? 'disabled' : ''}>Save selection</button></div>
    </form></section>`;
}
