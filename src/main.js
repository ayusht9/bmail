import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { historyPane } from './history.js';
import { createDashboardPoller } from './polling.js';
import { statisticsPanel, coverageRows } from './statistics.js';
import { folderNavigation, recentMailPane, mailboxFolders } from './desktop.js';
import { progressPanel } from './progress.js';
import { schedulerDialog, scheduleFromForm, normalizeSchedule, nextRuns, calendarMarkup, scheduleSummary, localDate, updateClock } from './scheduler.js';
import { selectionSummary, selectionDialog, folderChoices, advancedFromForm } from './selection.js';

const app = document.querySelector('#app');
let dashboard;
let busy = false;
let controlBusy = false;
let addingAccount = false;
let selectedFolder = '';
let folderFilter = '';
let operationFailure = null;
let busyAction = '';
let activityOpen = false;
let historyOpen = false;
let historyFilter = 'all';
let selectedHistoryRun = '';
let dashboardPoller;
let schedulerMonth = new Date();
let schedulerFocusDate = '';
let schedulerBusy = false;
const providerForHost = host => host?.toLowerCase() === 'imap.gmail.com' ? 'google' : host?.toLowerCase() === 'imappro.zoho.in' ? 'zoho' : 'other';

function updateProviderHelp() {
  const google = document.querySelector('#mail-provider').value === 'google';
  document.querySelector('#provider-help').textContent = google
    ? 'Turn on Google 2-Step Verification, then create an app password. Use that 16-character password here. Some work or school accounts do not allow app passwords.'
    : 'Use the application-specific password supplied by your email provider.';
  document.querySelector('[data-action="google-help"]').hidden = !google;
  const port = document.querySelector('#mail-port');
  port.readOnly = google;
  if (google) port.value = '993';
}

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[char]));

const formatDate = value => value ? new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', timeStyle: 'short'
}).format(new Date(value)) : 'Never';

const formatNumber = value => new Intl.NumberFormat('en-IN').format(value || 0);

function render() {
  if (!dashboard) {
    app.innerHTML = '<main class="loading"><span class="spinner"></span>Reading your backup…</main>';
    return;
  }
  const run = dashboard.lastRun;
  const hasAccount = !addingAccount && dashboard.user.includes('@');
  const mailHost = addingAccount ? 'imap.gmail.com' : dashboard.host;
  const mailPort = addingAccount ? 993 : dashboard.port;
  const healthy = run?.success === true;
  const outcome = run?.outcome || dashboard.progress?.state;
  const intentional = ['stopped', 'cancelled'].includes(outcome);
  const state = healthy ? 'healthy' : run && !intentional ? 'attention' : 'empty';
  const statusTitle = dashboard.backupRunning ? dashboard.progress?.state === 'paused' ? 'Your backup is paused' : 'Your backup is running'
    : intentional ? outcome === 'stopped' ? 'Backup stopped safely' : 'Backup cancelled' : healthy ? 'Selected backup complete' : run ? 'Last run needs attention' : dashboard.hasManifest ? 'Ready to continue your backup' : 'Ready for the first backup';
  if (selectedFolder && !mailboxFolders(dashboard).includes(selectedFolder)) selectedFolder = '';
  const folderRows = coverageRows(dashboard, escapeHtml, formatNumber, selectedFolder, folderFilter);

  app.innerHTML = `
    <header class="app-toolbar">
      <div class="app-name"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 5h18v14H3zM3 6l9 7 9-7"/></svg><strong>Bmail</strong></div>
      <button class="primary" data-action="backup" ${busy || dashboard.backupRunning || !dashboard.credentialReady ? 'disabled' : ''}>${busyAction === 'backup' ? 'Starting...' : 'Back up now'}</button>
      <button data-action="stats" ${busy || dashboard.backupRunning || !dashboard.credentialReady ? 'disabled' : ''}>${busyAction === 'stats' ? 'Checking mailbox...' : 'Check mailbox'}</button>
      <span class="toolbar-separator"></span>
      <button data-action="selection" ${busy || dashboard.backupRunning || !dashboard.credentialReady ? 'disabled' : ''}>Backup selection</button>
      <button data-action="open-backups">Open backup folder</button>
      <div class="toolbar-spacer"></div>
      <button data-action="refresh" ${busy ? 'disabled' : ''}>Refresh</button>
    </header>
    <div class="desktop-layout">
      <aside class="folder-sidebar" aria-label="Accounts and folders">
        <div class="account-switcher"><label for="active-account">Account</label><select id="active-account" ${busy || dashboard.backupRunning || !dashboard.accounts?.length ? 'disabled' : ''}>
          ${dashboard.accounts?.length ? dashboard.accounts.map(email => `<option value="${escapeHtml(email)}" ${email === dashboard.user ? 'selected' : ''}>${escapeHtml(email)}</option>`).join('') : '<option>No mailbox configured</option>'}</select></div>
        <div class="sidebar-heading"><h2>Folders</h2><button class="icon-button" data-action="add-account" aria-label="Add account" title="Add account" ${busy || dashboard.backupRunning ? 'disabled' : ''}>+</button></div>
        <label class="filter-field"><span class="sr-only">Filter folders</span><input id="folder-filter" type="search" placeholder="Filter folders" value="${escapeHtml(folderFilter)}"></label>
        <nav class="folder-list" aria-label="Mailbox folders"><button class="folder-item ${!selectedFolder ? 'selected' : ''}" data-action="select-folder" data-folder="" aria-pressed="${!selectedFolder}"><span>All folders</span><small>${formatNumber(dashboard.localStats?.messages || 0)}</small></button>
          ${folderNavigation(dashboard, selectedFolder, folderFilter, escapeHtml, formatNumber) || `<p class="sidebar-empty">${folderFilter ? 'No matching folders.' : 'Check your mailbox to load folders.'}</p>`}</nav>
        <div class="sidebar-tools"><button data-action="setup" ${busy ? 'disabled' : ''}>${dashboard.credentialReady ? 'Account settings' : 'Set up mailbox'}</button>
          <button data-action="schedule" ${busy || !dashboard.credentialReady ? 'disabled' : ''}>Scheduler</button>
          <button data-action="verify" ${busy || dashboard.backupRunning || !dashboard.hasManifest ? 'disabled' : ''}>Verify local files</button>
          <button data-action="toggle-history" aria-pressed="${historyOpen}">Backup history</button><button data-action="toggle-activity" aria-pressed="${activityOpen}">Activity log</button></div>
      </aside>
      <main class="mail-workspace">
        <div class="workspace-heading"><div><h1>${escapeHtml(selectedFolder || 'All folders')}</h1><p>${escapeHtml(dashboard.user)}</p></div><span class="connection-status">Read-only IMAP</span></div>
        <section class="run-banner ${state}" aria-label="Backup status"><h2>${statusTitle}</h2><span>${run?.finishedAt ? formatDate(run.finishedAt) : 'No backup run yet'}</span></section>
        ${operationFailure ? `<section class="operation-error" role="alert"><div><strong>${operationFailure.action === 'stats' ? 'Mailbox check failed' : 'Action failed'}</strong><p>${escapeHtml(operationFailure.message)}</p></div><div><button data-action="${escapeHtml(operationFailure.action)}" ${busy ? 'disabled' : ''}>Retry</button><button data-action="dismiss-error">Dismiss</button></div></section>` : ''}
        ${!dashboard.credentialReady ? `<aside class="notice">Save an account and app password to start backing up. <button data-action="setup" ${busy ? 'disabled' : ''}>Set up mailbox</button></aside>` : ''}
        ${run?.error ? `<aside class="notice error">${escapeHtml(run.error.message || 'Backup failed')}. Completed downloads are retained.</aside>` : ''}
        ${dashboard.launchError ? `<aside class="notice error">${escapeHtml(dashboard.launchError)}</aside>` : ''}
        ${dashboard.migrationNotice ? `<aside class="notice">${escapeHtml(dashboard.migrationNotice)}</aside>` : ''}
        ${dashboard.backupRunning ? progressPanel(dashboard, escapeHtml, formatNumber) : ''}
        ${historyOpen ? historyPane(dashboard, historyFilter, selectedHistoryRun, escapeHtml, formatDate, formatNumber) : `
        <section class="folder-pane" aria-label="Folder coverage"><div class="pane-title"><h2>Folder coverage</h2><span>${formatNumber(mailboxFolders(dashboard).length)} folders</span></div>
          <div class="table-wrap"><table class="folder-table"><thead><tr><th>Folder</th><th>Saved locally</th><th>On server</th><th>Remaining</th></tr></thead><tbody>${folderRows || '<tr><td colspan="4" class="empty-pane">No folders to show. Check mailbox to load coverage.</td></tr>'}</tbody></table></div></section>
        ${recentMailPane(dashboard, selectedFolder, escapeHtml, formatDate)}
        `}
        ${activityOpen ? `<section class="activity-pane" aria-label="Activity log"><div class="pane-title"><h2>Activity log</h2><button data-action="open-logs">Open log folder</button></div><pre>${escapeHtml(dashboard.latestLog?.tail || 'No activity recorded yet.')}</pre></section>` : ''}
      </main>
      <aside class="inspector" aria-label="Account overview">
        ${statisticsPanel(dashboard, escapeHtml, formatNumber, formatDate, busy)}
        <section class="selection-summary"><h2>Backup selection</h2><p>${escapeHtml(selectionSummary(dashboard.backupOptions))}</p><button data-action="selection" ${busy || dashboard.backupRunning || !dashboard.credentialReady ? 'disabled' : ''}>Choose what to back up</button></section>
        <section class="storage-summary"><h2>Storage</h2><p>${escapeHtml(dashboard.dataDirectory || 'Available after account setup')}</p><button data-action="open-backups">Open location</button></section>
      </aside>
    </div>
    <footer class="statusbar"><span>${busy ? busyAction === 'stats' ? 'Checking mailbox and verifying saved files...' : 'Working...' : dashboard.backupRunning ? 'Backup active' : 'Ready'}</span><span>Schedule: ${escapeHtml(scheduleSummary(dashboard.schedule, dashboard.scheduleInstalled))}</span><span>Manual app updates</span></footer>
    <div id="toast" role="status"></div>
    ${selectionDialog(dashboard, escapeHtml)}
    ${schedulerDialog(dashboard, escapeHtml)}
    <dialog id="mailbox-dialog" aria-labelledby="setup-title" aria-describedby="setup-description">
      <form id="mailbox-form">
        <h2 id="setup-title">${hasAccount ? 'Update app password' : 'Set up your mailbox'}</h2>
        <p id="setup-description">Use your IMAP server and application-specific password. Your password is encrypted for this Windows user.</p>
        <label for="mail-provider">Email provider</label>
        <select id="mail-provider" ${hasAccount ? 'disabled' : ''}>
          <option value="google" ${providerForHost(mailHost) === 'google' ? 'selected' : ''}>Google / Gmail</option>
          <option value="zoho" ${providerForHost(mailHost) === 'zoho' ? 'selected' : ''}>Zoho India</option>
          <option value="other" ${providerForHost(mailHost) === 'other' ? 'selected' : ''}>Other IMAP server</option>
        </select>
        <label for="mail-user">Email address</label>
        <input id="mail-user" name="user" type="email" autocomplete="username" value="${hasAccount ? escapeHtml(dashboard.user) : ''}" ${hasAccount ? 'readonly' : ''} required>
        <label for="mail-host">IMAP server</label>
        <input id="mail-host" name="host" type="text" value="${escapeHtml(mailHost)}" pattern="[a-zA-Z0-9.\\-]+" ${hasAccount ? 'readonly' : ''} required>
        <label for="mail-port">TLS port</label>
        <input id="mail-port" name="port" type="number" min="1" max="65535" value="${mailPort}" ${hasAccount ? 'readonly' : ''} required>
        <p id="provider-help"></p>
        <button type="button" class="text-button" data-action="google-help" hidden>How to create a Google app password</button>
        <label for="mail-password">Application-specific password</label>
        <input id="mail-password" name="password" type="password" autocomplete="new-password" aria-describedby="provider-help" required>
        <p id="setup-error" role="alert"></p>
        <div class="dialog-actions"><button type="button" class="ghost" data-action="cancel-setup">Cancel</button><button class="primary" type="submit">Save mailbox</button></div>
      </form>
    </dialog>
  `;
  updateProviderHelp();
}

function toast(message, isError = false) {
  const element = document.querySelector('#toast');
  if (!element) return;
  element.textContent = message;
  element.className = `show ${isError ? 'error' : ''}`;
  setTimeout(() => element.className = '', 4500);
}

let refreshing = false;
let refreshFinished = Promise.resolve();
async function refresh(background = false, force = false) {
  if (refreshing) {
    if (background) return;
    await refreshFinished;
    return refresh(false, force);
  }
  refreshing = true;
  let finished;
  refreshFinished = new Promise(resolve => { finished = resolve; });
  try {
    const next = await invoke('get_dashboard', { force });
    const unchanged = JSON.stringify(next) === JSON.stringify(dashboard);
    dashboard = next;
    if (background && (unchanged || document.querySelector('dialog[open]'))) return;
    const focusAction = document.activeElement?.dataset?.action;
    const focusFolder = document.activeElement?.dataset?.folder;
    const filterInput = document.activeElement?.id === 'folder-filter' ? document.activeElement : null;
    const coverageHelpOpen = document.querySelector('.coverage-help')?.open;
    const scrollPositions = [...document.querySelectorAll('.folder-list, .mail-workspace, .inspector, .table-wrap')].map(el => el.scrollTop);
    render();
    document.querySelectorAll('.folder-list, .mail-workspace, .inspector, .table-wrap').forEach((el, index) => el.scrollTop = scrollPositions[index] || 0);
    if (coverageHelpOpen) document.querySelector('.coverage-help').open = true;
    if (filterInput) { document.querySelector('#folder-filter').replaceWith(filterInput); filterInput.focus({ preventScroll: true }); }
    if (focusAction === 'select-folder') [...document.querySelectorAll('[data-action="select-folder"]')].find(el => el.dataset.folder === focusFolder)?.focus({ preventScroll: true });
    if (focusAction && focusAction !== 'select-folder') [...document.querySelectorAll('[data-action]')].find(el => el.dataset.action === focusAction)?.focus({ preventScroll: true });
  } catch (error) {
    if (!background) app.innerHTML = `<main class="fatal"><h1>Bmail could not start</h1><p>${escapeHtml(error)}</p></main>`;
  } finally { refreshing = false; finished(); dashboardPoller?.reschedule(); }
}

async function run(action) {
  if (busy) return;
  busy = true;
  busyAction = action;
  operationFailure = null;
  render();
  let message;
  let failed = false;
  try {
    message = action === 'backup' ? await invoke('start_backup') : await invoke('run_action', { action });
  } catch (error) {
    message = String(error);
    failed = true;
    operationFailure = { action, message };
  } finally {
    busy = false;
    busyAction = '';
    await refresh();
    toast(failed ? (action === 'stats' ? 'Mailbox check failed. See the error above.' : 'Action failed. See the error above.') : message, failed);
  }
}

app.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'backup-preset') {
    const form = document.querySelector('#selection-form');
    const custom = button.dataset.preset === 'custom';
    form.elements.allFolders.checked = !custom;
    document.querySelector('#folder-choices').disabled = !custom;
    if (!custom) {
      for (const name of ['dateFrom','dateTo','maxMessages','excludedFolders','sender','subject','minSizeKB','maxSizeMB']) form.elements[name].value = '';
      form.elements.lastDays.value = button.dataset.preset === 'recent' ? '30' : '';
      form.elements.unreadOnly.checked = form.elements.flaggedOnly.checked = false;
      form.elements.verifyAfterBackup.checked = form.elements.checkMailboxAfterBackup.checked = true;
      if (button.dataset.preset === 'recent') form.querySelector('.advanced-backup').open = true;
    }
    document.querySelector('#selection-error').textContent = '';
    return;
  }
  if (action === 'test-notification') { testNotification(button); return; }
  if (action === 'toggle-history') { historyOpen = !historyOpen; render(); return; }
  if (action === 'history-select') { selectedHistoryRun = button.dataset.runId; render(); return; }
  if (action === 'schedule') { openScheduler(); return; }
  if (action === 'cancel-schedule') { if (!schedulerBusy) document.querySelector('#scheduler-dialog').close(); return; }
  if (action === 'schedule-read') { scheduleOperation('read'); return; }
  if (action === 'schedule-remove') { scheduleOperation('remove'); return; }
  if (action === 'schedule-prev' || action === 'schedule-next') { schedulerMonth = new Date(schedulerMonth.getFullYear(), schedulerMonth.getMonth() + (action === 'schedule-next' ? 1 : -1), 1); schedulerFocusDate = localDate(schedulerMonth); updateSchedulePreview(); return; }
  if (action === 'schedule-day') { const date = button.dataset.date; document.querySelector('#schedule-date').value = date; schedulerFocusDate = date; schedulerMonth = new Date(`${date}T00:00:00`); updateSchedulePreview(); document.querySelector(`.schedule-calendar [data-date="${date}"]`)?.focus(); return; }
  if (action === 'select-folder') { selectedFolder = button.dataset.folder; render(); return; }
  if (action === 'toggle-activity') { activityOpen = !activityOpen; render(); return; }
  if (action === 'dismiss-error') { operationFailure = null; render(); return; }
  if (action === 'setup') document.querySelector('#mailbox-dialog').showModal();
  else if (action === 'add-account') { addingAccount = true; render(); document.querySelector('#mailbox-dialog').showModal(); }
  else if (['pause', 'resume', 'stop', 'cancel'].includes(action)) controlBackup(action, button.dataset.runId);
  else if (action === 'selection') document.querySelector('#selection-dialog').showModal();
  else if (action === 'cancel-selection') { if (busy) return; document.querySelector('#selection-dialog').close(); render(); }
  else if (action === 'load-folders') loadFolders();
  else if (action === 'google-help') invoke('open_google_help').catch(error => toast(String(error), true));
  else if (action === 'cancel-setup') {
    document.querySelector('#mail-password').value = '';
    document.querySelector('#mailbox-dialog').close();
    addingAccount = false;
    render();
  }
  else if (action === 'refresh') refresh(false, true);
  else if (action.startsWith('open-')) invoke('open_directory', { kind: action.slice(5) }).catch(error => toast(String(error), true));
  else run(action);
});

app.addEventListener('input', event => {
  if (event.target.closest('#scheduler-form')) {
    if (event.target.id === 'schedule-date' && /^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) {
      schedulerFocusDate = event.target.value; schedulerMonth = new Date(`${event.target.value}T00:00:00`);
    }
    updateSchedulePreview(); return;
  }
  if (event.target.id !== 'folder-filter') return;
  const input = event.target;
  folderFilter = input.value;
  selectedFolder = '';
  render();
  document.querySelector('#folder-filter').replaceWith(input);
  input.focus({ preventScroll: true });
});

app.addEventListener('change', event => {
  if (event.target.id === 'history-filter') { historyFilter = event.target.value; render(); return; }
  if (event.target.closest('#scheduler-form')) { updateSchedulePreview(); return; }
  if (event.target.id === 'active-account') switchAccount(event.target.value);
  if (event.target.id === 'all-folders') {
    document.querySelector('#folder-choices').disabled = event.target.checked;
  }
  if (event.target.id === 'mail-provider') {
    const provider = event.target.value;
    document.querySelector('#mail-host').value = provider === 'google' ? 'imap.gmail.com' : provider === 'zoho' ? 'imappro.zoho.in' : '';
    document.querySelector('#mail-port').value = '993';
    updateProviderHelp();
  } else if (event.target.id === 'mail-host') {
    document.querySelector('#mail-provider').value = providerForHost(event.target.value.trim());
    updateProviderHelp();
  }
});

app.addEventListener('cancel', event => {
  if (event.target.id === 'scheduler-dialog' && schedulerBusy) event.preventDefault();
  if (event.target.id === 'selection-dialog' && busy) event.preventDefault();
  if (event.target.id === 'mailbox-dialog' && !busy) {
    document.querySelector('#mail-password').value = '';
    addingAccount = false;
  }
}, true);

async function loadFolders() {
  if (busy) return;
  busy = true;
  const button = document.querySelector('[data-action="load-folders"]');
  const submit = document.querySelector('#selection-form [type="submit"]');
  button.disabled = submit.disabled = true;
  button.textContent = 'Loading folders...';
  try {
    await invoke('run_action', { action: 'folders' });
    dashboard = await invoke('get_dashboard');
    const selected = [...document.querySelectorAll('[name="folders"]:checked')].map(el => el.value);
    document.querySelector('#folder-options').innerHTML = folderChoices(dashboard.mailboxes?.folders || [], selected, document.querySelector('#all-folders').checked, escapeHtml);
    document.querySelector('#selection-error').textContent = '';
  } catch (error) { document.querySelector('#selection-error').textContent = String(error); }
  finally { busy = false; button.disabled = submit.disabled = false; button.textContent = 'Load / refresh mailbox folders'; }
}

async function controlBackup(command, runId) {
  if (controlBusy) return;
  controlBusy = true;
  document.querySelectorAll('.progress-actions button').forEach(el => el.disabled = true);
  try {
    const result = await invoke('control_backup', { command, runId });
    await refresh();
    toast(result);
  } catch (error) { toast(String(error), true); await refresh(); }
  finally { controlBusy = false; }
}

async function switchAccount(email) {
  if (busy || dashboard.backupRunning) return;
  busy = true;
  operationFailure = null;
  selectedFolder = '';
  folderFilter = '';
  selectedHistoryRun = '';
  render();
  try { await invoke('switch_account', { email }); }
  catch (error) { toast(String(error), true); }
  finally { busy = false; await refresh(); }
}

async function testNotification(button) {
  if (busy) return;
  busy = true;
  button.disabled = true;
  button.textContent = 'Sending test...';
  try { document.querySelector('#notification-status').textContent = await invoke('test_notification'); }
  catch (error) { document.querySelector('#selection-error').textContent = String(error); }
  finally { busy = false; button.disabled = false; button.textContent = 'Send test notification'; dashboardPoller?.reschedule(); }
}

function updateScheduleStatus() {
  const status = dashboard.schedule;
  const element = document.querySelector('#schedule-status');
  if (!element) return;
  element.innerHTML = status ? `<strong>Windows: ${escapeHtml(status.state)}</strong><p>Next run: ${status.nextRunTime ? formatDate(status.nextRunTime) : 'None reported'}<br>Last run: ${status.lastRunTime ? formatDate(status.lastRunTime) : 'Never'}${status.lastResult != null ? `<br>Last task result: ${escapeHtml(status.lastResult)}` : ''}<br>Status checked: ${formatDate(status.checkedAt)}</p>` : '<p>No Windows status loaded yet.</p>';
  document.querySelector('[data-action="schedule-remove"]').disabled = schedulerBusy || !status?.installed || dashboard.backupRunning;
}

function updateSchedulePreview() {
  const form = document.querySelector('#scheduler-form');
  if (!form) return;
  const draft = scheduleFromForm(form);
  form.querySelectorAll('[data-recurrence]').forEach(element => {
    element.hidden = !element.dataset.recurrence.split(' ').includes(draft.frequency);
    element.querySelectorAll('input,select').forEach(input => input.disabled = element.hidden);
  });
  document.querySelector('#schedule-every').max = draft.frequency === 'weekly' ? 52 : 365;
  let schedule;
  try { schedule = normalizeSchedule(draft); document.querySelector('#schedule-error').textContent = ''; }
  catch (error) { document.querySelector('#schedule-error').textContent = error.message; schedule = { ...draft, enabled: false }; }
  document.querySelector('#schedule-calendar').innerHTML = calendarMarkup(schedule, schedulerMonth, schedulerFocusDate, escapeHtml);
  const runs = nextRuns(schedule);
  document.querySelector('#schedule-upcoming').innerHTML = `<h3>Upcoming preview</h3>${runs.length ? `<ol>${runs.map(date => `<li>${formatDate(date)}</li>`).join('')}</ol>` : '<p>No upcoming runs for these settings.</p>'}<p class="muted">Preview only. Windows next-run status is authoritative. Dots are planned dates, not completed backups.</p>`;
  updateClock();
}

async function openScheduler() {
  if (busy) return;
  const dialog = document.querySelector('#scheduler-dialog');
  dialog.showModal();
  schedulerFocusDate = document.querySelector('#schedule-date').value;
  schedulerMonth = new Date(`${schedulerFocusDate}T00:00:00`);
  updateSchedulePreview(); updateScheduleStatus();
  await scheduleOperation('read', true);
}

async function scheduleOperation(action, loadSettings = false) {
  if (schedulerBusy) return;
  const dialog = document.querySelector('#scheduler-dialog');
  const form = document.querySelector('#scheduler-form');
  if (action !== 'read' && dashboard.backupRunning) { document.querySelector('#schedule-error').textContent = 'Finish the current backup before changing its schedule.'; return; }
  let replaceForm = false;
  let schedule;
  try { if (action === 'save') schedule = normalizeSchedule(scheduleFromForm(form)); }
  catch (error) { document.querySelector('#schedule-error').textContent = error.message; return; }
  schedulerBusy = true; busy = true;
  document.querySelector('#schedule-error').textContent = '';
  const controls = [...form.querySelectorAll('button,input,select')];
  const enabled = controls.filter(control => !control.disabled);
  enabled.forEach(control => control.disabled = true);
  try {
    const result = await invoke('manage_schedule', { action, schedule: schedule || null });
    dashboard.schedule = result; dashboard.scheduleInstalled = result.installed;
    // Preserve draft edits on a status refresh. Save/remove replace the form
    // only after Windows confirms the operation succeeded.
    replaceForm = action !== 'read' || loadSettings;
    updateScheduleStatus();
    if (action === 'save') toast(result.enabled ? 'Schedule saved in Windows.' : 'Schedule paused.');
    if (action === 'remove') toast('Schedule removed. Backup files are kept.');
  } catch (error) { document.querySelector('#schedule-error').textContent = String(error); }
  finally {
    schedulerBusy = false; busy = false;
    enabled.forEach(control => control.disabled = false);
    if (replaceForm) {
      const reopen = dialog.open;
      dialog.close();
      render();
      if (reopen) document.querySelector('#scheduler-dialog').showModal();
      schedulerFocusDate = document.querySelector('#schedule-date').value;
      schedulerMonth = new Date(`${schedulerFocusDate}T00:00:00`);
      updateSchedulePreview();
    }
    updateScheduleStatus();
    dashboardPoller?.reschedule();
  }
}

app.addEventListener('keydown', event => {
  const button = event.target.closest('.schedule-calendar [data-date]');
  if (!button || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const date = new Date(`${button.dataset.date}T00:00:00`);
  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -date.getDay(), End: 6 - date.getDay() }[event.key];
  date.setDate(date.getDate() + offset);
  schedulerFocusDate = localDate(date); schedulerMonth = date;
  updateSchedulePreview();
  document.querySelector(`.schedule-calendar [data-date="${schedulerFocusDate}"]`)?.focus();
});

app.addEventListener('submit', async event => {
  if (event.target.id === 'scheduler-form') { event.preventDefault(); scheduleOperation('save'); return; }
  if (event.target.id === 'selection-form') {
    event.preventDefault();
    if (busy) return;
    const form = event.target;
    const values = new FormData(form);
    const folders = document.querySelector('#all-folders').checked ? [] : values.getAll('folders');
    const dateFrom = values.get('dateFrom') || null;
    const dateTo = values.get('dateTo') || null;
    if ((!document.querySelector('#all-folders').checked && !folders.length) || (dateFrom && dateTo && dateFrom > dateTo)) {
      document.querySelector('#selection-error').textContent = !document.querySelector('#all-folders').checked && !folders.length ? 'Choose at least one folder or select all folders.' : 'The start date must be before the end date.';
      return;
    }
    busy = true;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = 'Saving...';
    try {
      const result = await invoke('save_backup_options', { options: { folders, dateFrom, dateTo, maxMessages: values.get('maxMessages') ? Number(values.get('maxMessages')) : null, advanced: advancedFromForm(values) } });
      document.querySelector('#selection-dialog').close();
      busy = false;
      await refresh();
      toast(result);
    } catch (error) { document.querySelector('#selection-error').textContent = String(error); }
    finally { busy = false; button.disabled = false; button.textContent = 'Save selection'; }
    return;
  }
  if (event.target.id !== 'mailbox-form') return;
  event.preventDefault();
  if (busy) return;
  const form = event.target;
  const values = new FormData(form);
  const settings = {
    user: values.get('user').trim(), host: values.get('host').trim(),
    port: Number(values.get('port')), password: values.get('password'),
  };
  busy = true;
  const dialog = document.querySelector('#mailbox-dialog');
  const preventCancel = event => event.preventDefault();
  dialog.addEventListener('cancel', preventCancel);
  const enabledControls = [...form.querySelectorAll('button, input, select')].filter(element => !element.disabled);
  enabledControls.forEach(element => element.disabled = true);
  form.querySelector('[type="submit"]').textContent = 'Saving...';
  document.querySelector('#setup-error').textContent = '';
  try {
    const result = await invoke('configure_mailbox', { settings });
    addingAccount = false;
    busy = false;
    dialog.close();
    await refresh();
    toast(result);
  } catch (error) {
    document.querySelector('#setup-error').textContent = String(error);
    document.querySelector('#setup-error').scrollIntoView({ block: 'nearest' });
  } finally {
    settings.password = '';
    values.delete('password');
    form.querySelector('[name="password"]').value = '';
    enabledControls.forEach(element => element.disabled = false);
    form.querySelector('[type="submit"]').textContent = 'Save mailbox';
    dialog.removeEventListener('cancel', preventCancel);
    busy = false;
  }
});

dashboardPoller = createDashboardPoller({
  refresh: () => refresh(true),
  state: () => ({ hidden: document.hidden, busy, controlBusy, backupRunning: Boolean(dashboard?.backupRunning) }),
});
document.addEventListener('visibilitychange', () => dashboardPoller.wake());
window.addEventListener('pagehide', () => dashboardPoller.stop());
render();
refresh().finally(() => dashboardPoller.start());
setInterval(updateClock, 1000);
