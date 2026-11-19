import { outlookHost, outlookAddressHost, providerForHost } from './mail-providers.js';
import { loadingIndicator } from './loading.js';
import './style.css';
import logoUrl from '../src-tauri/icons/app.svg';
import { paneDivider, installPaneResizing, paneResizeActive } from './panes.js';
import { installColumnResizing, columnResizeActive } from './columns.js';
import { themePreference, setTheme } from './theme.js';
import { invoke as nativeInvoke } from '@tauri-apps/api/core';
import { userMessage, createSafeInvoke, installGlobalErrorHandlers } from './errors.js';
const invoke = createSafeInvoke(nativeInvoke);
import { workspaceTabs, workspaceTabStrip } from './workspace.js';
import { historyPane } from './history.js';
import { readingPane } from './reader.js';
import { createDashboardPoller } from './polling.js';
import { createNavigation } from './navigation.js';
import { preferencesView } from './preferences.js';
import { createNotificationCenter } from './notification-center.js';
import { setAppearance } from './appearance.js';
import { windowControls, controlWindow, startupHeader } from './window-chrome.js';
import { normalizeNewMailCount, totalNewMail, createBadgeSync } from './notifications.js';
import { folderNavigation, savedMailPane, mailboxFolders } from './desktop.js';
import { progressPanel, statusDownloadProgress, backupControls } from './progress.js';
import { schedulerView, scheduleFolderChoices, scheduleFromForm, normalizeSchedule, nextRuns, calendarMarkup, scheduleSummary, localDate, updateClock } from './scheduler.js';
import { backupOptionsView, folderChoices, advancedFromForm } from './selection.js';

const app = document.querySelector('#app');
let dashboard;
const notificationCenter = createNotificationCenter({
  account: () => dashboard?.user || '',
  escape: value => escapeHtml(value),
  date: value => formatDate(value),
  onChange: () => updateStatusBar(),
});

let busy = false;
let controlBusy = false;
let activeExports = 0;
let desktopPreferences = null;
let preferencesSaving = false;
let preferencesError = '';

async function loadDesktopPreferences() {
  try {
    desktopPreferences = await invoke('get_desktop_preferences');
    preferencesError = '';
  } catch (error) { preferencesError = userMessage(error); }
  if (dashboard && activeTab === 'preferences') render();
}

async function saveCloseBehavior(value) {
  preferencesSaving = true;
  preferencesError = '';
  render();
  let saved = false;
  try {
    desktopPreferences = await invoke('save_desktop_preferences', { preferences: { closeToTray: value === 'tray' } });
    saved = true;
  } catch (error) { preferencesError = userMessage(error); }
  finally {
    preferencesSaving = false;
    if (activeTab === 'preferences') {
      render();
      document.querySelector('#close-behavior')?.focus({ preventScroll: true });
    }
    if (saved) toast('Window preference saved.');
    dashboardPoller?.reschedule();
  }
}

const syncMailBadge = createBadgeSync(invoke);
const startupMailChecked = new Set();
const newMailRetryAfter = new Map();
const newMailByAccount = new Map();
const mailIndicators = () => newMailByAccount.get(dashboard?.user) || new Map();

function rememberNewMail(snapshot, account = dashboard.user) {
  savedMail.key = '';
  newMailByAccount.set(account, new Map((snapshot?.folders || []).map(folder => [folder.name, normalizeNewMailCount(folder.newMessages)])));
  if (account === dashboard?.user) void syncMailBadge(account, totalNewMail(mailIndicators()));
  const count = totalNewMail(mailIndicators());
  if (account === dashboard?.user && count > 0) notificationCenter.notify(`${count} new email${count === 1 ? '' : 's'} found in your mailbox.`, {
    level: 'info', transient: false, key: `mail:${snapshot.checkedAt || JSON.stringify(snapshot.folders)}`,
  });
}

async function checkStartupMail() {
  if (!dashboard?.credentialReady || !dashboard.user.includes('@') || dashboard.backupRunning || busy || startupMailChecked.has(dashboard.user) || Date.now() < (newMailRetryAfter.get(dashboard.user) || 0)) return;
  const account = dashboard.user;
  startupMailChecked.add(account);
  busy = true; busyAction = 'new-mail';
  captureTabDraft(); render();
  let failed = false;
  try {
    const result = await invoke('run_action', { action: 'new-mail' });
    rememberNewMail(JSON.parse(result), account);
    newMailRetryAfter.delete(account);
    if (operationFailure?.action === 'new-mail') operationFailure = null;
  } catch (error) {
    if (error?.code === 'NEW_MAIL_CHECK_BUSY') {
      startupMailChecked.delete(account);
      newMailRetryAfter.set(account, Date.now() + 10000);
    } else {
      failed = true;
      operationFailure = { action: 'new-mail', message: userMessage(error) };
    }
  } finally {
    busy = false; busyAction = '';
    await refresh();
    if (failed) toast('New mail check failed. See the error above.', true);
  }
}

let addingAccount = false;
let selectedFolder = '';
let folderFilter = '';
let savedMail = { key: '', rows: [], loading: false, error: '' };
let selectedMessage = { file: '', message: null, loading: false, error: '' };
let messageFolderKey = '';

function mailList() { return savedMailPane(savedMail, selectedFolder, mailSort, escapeHtml, formatDate, selectedMessage.id || selectedMessage.file); }
function updateReader() {
  const pane = document.querySelector('.reading-pane');
  if (pane && activeTab === 'mailbox') pane.outerHTML = readingPane(selectedMessage, escapeHtml, formatDate);
}
function openMessage(file, id = file) {
  const row = savedMail.rows.find(message => (message.id || message.file) === id);
  if (row && !row.backedUp) {
    selectedMessage = { id, file: '', unavailable: true, onServer: row.onServer, message: row };
    updateReader();
    document.querySelectorAll('.mail-table tbody tr').forEach(element => element.classList.toggle('selected', element.dataset.id === id));
    return;
  }
  if (!file) return;
  const request = { id, file, message: null, loading: true, error: '' };
  selectedMessage = request;
  updateReader();
  document.querySelectorAll('.mail-table tbody tr').forEach(row => row.classList.toggle('selected', row.dataset.id === id));
  invoke('get_saved_message', { file }).then(message => { request.message = message; }).catch(error => { request.error = userMessage(error); }).finally(() => {
    request.loading = false;
    if (selectedMessage === request) updateReader();
  });
}

let mailSort = { column: 'sentAt', direction: 'desc' };
let mailPage = 1;
let mailPageSize = 50;
let mailPageContext = '';
try {
  const saved = Number(localStorage.getItem('bmail-mail-page-size'));
  if ([25, 50, 100].includes(saved)) mailPageSize = saved;
} catch { /* Keep the default if storage is unavailable. */ }

function reloadMailList(focusSelector) {
  savedMail.key = '';
  loadSavedMail(focusSelector);
  const pane = document.querySelector('.mail-pane');
  if (pane) pane.outerHTML = mailList();
}


function loadSavedMail(focusSelector) {
  const context = JSON.stringify([dashboard.user, selectedFolder]);
  if (mailPageContext !== context) { mailPage = 1; mailPageContext = context; }
  const key = JSON.stringify([context, dashboard.localStats, dashboard.mailIndexStamp, mailPage, mailPageSize, mailSort]);
  if (savedMail.key === key) return;
  const request = { key, rows: [], loading: true, error: '', page: mailPage, pageSize: mailPageSize, pages: savedMail.pages || 1, total: savedMail.total || 0 };
  savedMail = request;
  invoke('get_mail_page', { folder: selectedFolder || null, page: mailPage, pageSize: mailPageSize, sortColumn: mailSort.column, sortDirection: mailSort.direction })
    .then(result => {
      Object.assign(request, result);
      if (savedMail === request) mailPage = result.page;
    })
    .catch(error => { request.error = userMessage(error); })
    .finally(() => {
      request.loading = false;
      if (savedMail === request && activeTab === 'mailbox' && !document.querySelector('dialog[open]')) {
        const pane = document.querySelector('.mail-pane');
        if (pane) pane.outerHTML = mailList();
        if (focusSelector) document.querySelector(focusSelector)?.focus({ preventScroll: true });
      }
    });
}

let operationFailure = null;
let busyAction = '';
let activeTab = 'mailbox';
const navigation = createNavigation({ tab: 'mailbox', folder: '', filter: '' });
let navigationAccount;

function rememberNavigation(tab, folder = selectedFolder) {
  navigation.remember(tab, folder, folderFilter);
}

function resetNavigation() {
  navigation.reset({ tab: activeTab, folder: selectedFolder, filter: folderFilter });
}

async function moveNavigation(direction) {
  if (busy || !navigation.canMove(direction)) return;
  captureTabDraft();
  const destination = navigation.move(direction, folderFilter);
  selectedFolder = destination.folder;
  folderFilter = destination.filter;
  await selectTab(destination.tab, false);
}

let backupOptionsDraft = null;
let schedulerDraft = null;
let schedulerLoaded = false;
let historyFilter = 'all';
let selectedHistoryRun = '';
let dashboardPoller;
let schedulerMonth = new Date();
let schedulerFocusDate = '';
let schedulerBusy = false;

async function startOutlookSignIn(button) {
  const form = button.form;
  const clientId = form.elements.client_id.value.trim();
  const status = document.querySelector('#outlook-sign-in-status');
  form.elements.device_code.value = '';
  button.disabled = true;
  status.textContent = 'Starting Microsoft sign-in...';
  try {
    const response = await invoke('begin_outlook_sign_in', { clientId });
    if (!form.isConnected || form.elements.client_id.value.trim() !== clientId || !outlookHost(form.elements.host.value)) return;
    form.elements.device_code.value = response.device_code;
    form.elements.device_interval.value = response.interval || 10;
    status.textContent = `Visit ${response.verification_uri} in your browser and enter ${response.user_code}. Then select Save mailbox to finish sign-in. This code expires in ${Math.floor(response.expires_in / 60)} minutes.`;
  } catch (error) { status.textContent = userMessage(error); }
  finally { button.disabled = false; }
}

function updateProviderHelp() {
  const google = document.querySelector('#mail-provider').value === 'google';
  const outlook = document.querySelector('#mail-provider').value === 'outlook';
  document.querySelector('#outlook-auth').hidden = !outlook;
  document.querySelector('#outlook-client-id').required = outlook;
  const password = document.querySelector('#mail-password');
  password.required = !outlook;
  password.hidden = outlook;
  document.querySelector('label[for="mail-password"]').style.display = outlook ? 'none' : '';
  document.querySelector('#provider-help').textContent = google
    ? 'Turn on Google 2-Step Verification, then create an app password. Use that 16-character password here. Some work or school accounts do not allow app passwords.'
    : outlook ? 'Outlook requires Microsoft sign-in. App passwords cannot be used. Bmail currently requires a Microsoft application (client) ID from an app registration. Enable IMAP in Outlook settings, then start sign-in below.' : 'Use the application-specific password supplied by your email provider.';
  document.querySelector('[data-action="google-help"]').hidden = !google;
  const port = document.querySelector('#mail-port');
  port.readOnly = google || outlook;
  if (google || outlook) port.value = '993';
}

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[char]));

const dateFormatter = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const numberFormatter = new Intl.NumberFormat('en-IN');
const formatDate = value => value ? dateFormatter.format(new Date(value)) : 'Never';
const formatNumber = value => numberFormatter.format(value || 0);

function folderStatus() {
  const local = (dashboard.localStats?.folders || []).filter(folder => !selectedFolder || folder.name === selectedFolder).reduce((sum, folder) => sum + folder.messages, 0);
  const server = (dashboard.mailboxStatus?.folders || []).filter(folder => !selectedFolder || folder.name === selectedFolder);
  const checked = dashboard.mailboxStatus && (!selectedFolder || server.length);
  const onServer = checked ? formatNumber(selectedFolder ? server.reduce((sum, folder) => sum + folder.serverMessages, 0) : dashboard.mailboxStatus.totalServerMessages) : 'Not checked';
  const remaining = checked ? formatNumber(selectedFolder ? server.reduce((sum, folder) => sum + folder.missingMessages, 0) : dashboard.mailboxStatus.missingMessages) : 'Not checked';
  return `${selectedFolder || 'All folders'}: ${formatNumber(local)} saved | ${onServer} on server | ${remaining} remaining`;
}

function statusBarContents() {
  return `<span class="status-message">${busy ? loadingIndicator(busyAction === 'new-mail' ? 'Checking new mail...' : busyAction === 'stats' ? 'Syncing mailbox...' : 'Working...') : dashboard.backupRunning ? 'Backup active' : ''}</span>${statusDownloadProgress(dashboard, formatNumber, activeExports)}<span class="status-summary"><span class="status-folder" title="${escapeHtml(folderStatus())}">${escapeHtml(folderStatus())}</span><span class="status-schedule">Schedule: ${escapeHtml(scheduleSummary(dashboard.schedule, dashboard.scheduleInstalled))}</span></span>`;
}

function updateBackupControls() {
  const controls = document.querySelector('.backup-controls');
  if (controls && dashboard) controls.outerHTML = backupControls(dashboard, busy, controlBusy, busyAction, escapeHtml);
}

function updateBackupProgress() {
  const page = document.querySelector('.backup-page');
  if (!page) return;
  const progress = page.querySelector('.run-progress');
  if (!dashboard.backupRunning) { progress?.remove(); return; }
  const html = progressPanel(dashboard, escapeHtml, formatNumber);
  if (progress) progress.outerHTML = html;
  else page.querySelector('.backup-page-actions')?.insertAdjacentHTML('afterend', html);
}

function updateStatusBar() {
  if (dashboard) void syncMailBadge(dashboard.user, totalNewMail(mailIndicators()));
  const footer = document.querySelector('.statusbar');
  if (footer && dashboard) footer.innerHTML = statusBarContents();
  const bell = document.querySelector('.navbar-notifications');
  if (bell) bell.innerHTML = notificationCenter.bell();
}

function render() {
  if (!dashboard) {
    app.innerHTML = `${startupHeader(logoUrl)}<main class="loading startup-loading"><img src="${logoUrl}" width="72" height="72" alt=""><h1>Bmail</h1>${loadingIndicator('Opening your local mailbox...')}<button data-action="refresh">Retry startup</button></main>`;
    return;
  }
  if (navigationAccount !== dashboard.user) {
    navigationAccount = dashboard.user;
    historyFilter = 'all'; selectedHistoryRun = '';
    resetNavigation();
  }
  const run = dashboard.lastRun;
  const hasAccount = !addingAccount && dashboard.user.includes('@');
  const repairOutlookHost = !addingAccount && !dashboard.hasManifest && outlookAddressHost(dashboard.host);
  const mailHost = addingAccount ? 'imap.gmail.com' : repairOutlookHost ? 'outlook.office365.com' : dashboard.host;
  const mailPort = addingAccount ? 993 : dashboard.port;
  const healthy = run?.success === true;
  const outcome = run?.outcome || dashboard.progress?.state;
  const intentional = ['stopped', 'cancelled'].includes(outcome);
  const state = healthy ? 'healthy' : run && !intentional ? 'attention' : 'empty';
  const statusTitle = dashboard.backupRunning ? dashboard.progress?.state === 'paused' ? 'Your backup is paused' : 'Your backup is running'
    : intentional ? outcome === 'stopped' ? 'Backup stopped safely' : 'Backup cancelled' : healthy ? 'Selected backup complete' : run ? 'Last run needs attention' : dashboard.hasManifest ? 'Ready to continue your backup' : 'Ready for the first backup';
  if (selectedFolder && !mailboxFolders(dashboard).includes(selectedFolder)) selectedFolder = '';
  if (activeTab === 'mailbox') loadSavedMail();
  const folderKey = JSON.stringify([dashboard.user, selectedFolder]);
  if (messageFolderKey !== folderKey) { messageFolderKey = folderKey; selectedMessage = { file: '', message: null, loading: false, error: '' }; }
  const workspaceBody = activeTab === 'preferences' ? preferencesView(themePreference(), desktopPreferences, preferencesSaving, preferencesError, escapeHtml)
    : activeTab === 'scheduler' ? schedulerView(dashboard, escapeHtml, schedulerDraft)
    : activeTab === 'options' ? `<div class="backup-page"><div class="backup-page-actions">${backupControls(dashboard, busy, controlBusy, busyAction, escapeHtml)}<button data-action="open-backups">Open backup folder</button></div>${dashboard.backupRunning ? progressPanel(dashboard, escapeHtml, formatNumber) : ''}${backupOptionsView(dashboard, escapeHtml, backupOptionsDraft)}</div>`
    : activeTab === 'activity' ? historyPane(dashboard, historyFilter, selectedHistoryRun, escapeHtml, formatDate, formatNumber)
    : `<div class="mailbox-panes">${mailList()}${paneDivider('mail')}${readingPane(selectedMessage, escapeHtml, formatDate)}</div>`;


  app.innerHTML = `
    <header class="app-toolbar" data-tauri-drag-region>
      <div class="app-name" data-tauri-drag-region><img data-tauri-drag-region class="app-logo" src="${logoUrl}" alt="" width="28" height="28"><strong data-tauri-drag-region>Bmail</strong></div>
      <div class="toolbar-spacer" data-tauri-drag-region></div>
      <div class="navbar-notifications">${notificationCenter.bell()}</div>
      ${windowControls()}
    </header>
    <div class="desktop-layout">
      <aside class="folder-sidebar" aria-label="Accounts and folders">
        <div class="account-switcher"><div class="account-heading"><label for="active-account">Account</label><button type="button" class="account-sync" data-action="stats" aria-label="Sync" title="Sync" aria-busy="${busyAction === 'stats'}" ${busy || dashboard.backupRunning || !dashboard.credentialReady ? 'disabled' : ''}>${busyAction === 'stats' ? '<span class="spinner" aria-hidden="true"></span>' : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 7a6 6 0 0 0-10-2L3 8m0-5v5h5M4 13a6 6 0 0 0 10 2l3-3m0 5v-5h-5"/></svg>'}</button><button type="button" class="account-sync" data-action="add-account" aria-label="Add account" title="Add account" ${busy || dashboard.backupRunning ? 'disabled' : ''}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg></button></div><select id="active-account" ${busy || dashboard.backupRunning || !dashboard.accounts?.length ? 'disabled' : ''}>
          ${dashboard.accounts?.length ? dashboard.accounts.map(email => `<option value="${escapeHtml(email)}" ${email === dashboard.user ? 'selected' : ''}>${escapeHtml(email)}</option>`).join('') : '<option>No mailbox configured</option>'}</select></div>
        <div class="sidebar-heading"><h2>Folders</h2></div>
        <label class="filter-field"><span class="sr-only">Filter folders</span><input id="folder-filter" type="search" placeholder="Filter folders" value="${escapeHtml(folderFilter)}"></label>
        <nav class="folder-list" aria-label="Mailbox folders"><button class="folder-item ${!selectedFolder ? 'selected' : ''}" data-action="select-folder" data-folder="" aria-pressed="${!selectedFolder}"><span>All folders</span><small>${formatNumber(dashboard.localStats?.messages || 0)}</small></button>
          ${folderNavigation(dashboard, selectedFolder, folderFilter, escapeHtml, formatNumber, mailIndicators()) || `<p class="sidebar-empty">${folderFilter ? 'No matching folders.' : 'Sync your mailbox to load folders.'}</p>`}</nav>
        <div class="sidebar-tools"><button data-action="setup" ${busy ? 'disabled' : ''}>${dashboard.credentialReady ? 'Account settings' : 'Set up mailbox'}</button>
        </div>
        ${paneDivider('sidebar')}
      </aside>
      <main class="mail-workspace">
        <div class="workspace-navigation"><nav class="navigation-buttons" aria-label="Navigation history">
          <button type="button" data-action="navigate-back" aria-label="Back" title="Back" ${busy || !navigation.canMove(-1) ? 'disabled' : ''}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m9 4-6 6 6 6M3 10h14"/></svg></button>
          <button type="button" data-action="navigate-forward" aria-label="Forward" title="Forward" ${busy || !navigation.canMove(1) ? 'disabled' : ''}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m11 4 6 6-6 6M3 10h14"/></svg></button>
        </nav>${workspaceTabStrip(activeTab, busy)}</div>
        ${!['mailbox', 'activity'].includes(activeTab) ? `<section class="run-banner ${state}" aria-label="Backup status"><h2>${statusTitle}</h2><span>${run?.finishedAt ? formatDate(run.finishedAt) : 'No backup run yet'}</span></section>` : ''}
        ${operationFailure ? `<section class="operation-error" role="alert"><div><strong>${operationFailure.action === 'new-mail' ? 'New mail check failed' : operationFailure.action === 'stats' ? 'Mailbox sync failed' : 'Action failed'}</strong><p>${escapeHtml(userMessage(operationFailure.message))}</p></div><div><button data-action="${escapeHtml(operationFailure.action)}" ${busy ? 'disabled' : ''}>Retry</button><button data-action="dismiss-error">Dismiss</button></div></section>` : ''}
        ${!dashboard.credentialReady ? `<aside class="notice">Connect an account to start backing up. <button data-action="setup" ${busy ? 'disabled' : ''}>Set up mailbox</button></aside>` : ''}
        ${run?.error ? `<aside class="notice error">${escapeHtml(userMessage(run.error))} Completed downloads are retained.</aside>` : ''}
        ${dashboard.launchError ? `<aside class="notice error">${escapeHtml(userMessage(dashboard.launchError))}</aside>` : ''}
        ${dashboard.migrationNotice ? `<aside class="notice">${escapeHtml(dashboard.migrationNotice)}</aside>` : ''}
        ${workspaceTabs.map(([key]) => `<section id="view-${key}" role="tabpanel" aria-labelledby="tab-${key}" ${activeTab === key ? 'tabindex="0"' : 'hidden'}>${activeTab === key ? workspaceBody : ''}</section>`).join('')}
      </main>
    </div>
    <footer class="statusbar">${statusBarContents()}</footer>
    ${notificationCenter.shell()}
    <dialog id="mailbox-dialog" aria-labelledby="setup-title" aria-describedby="setup-description">
      <form id="mailbox-form">
        <div class="mailbox-settings-heading"><h2 id="setup-title">${hasAccount ? (outlookHost(mailHost) ? 'Sign in to Microsoft again' : 'Update app password') : 'Set up your mailbox'}</h2>${hasAccount ? `<button type="button" class="account-sync account-remove" data-action="remove-mailbox" aria-label="Remove mailbox" title="Remove mailbox" ${busy || dashboard.backupRunning || activeExports ? 'disabled' : ''}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M8 5V3h4v2M5 5l1 12h8l1-12M8 8v6m4-6v6"/></svg></button>` : ''}</div>
        <p id="setup-description">Connect with Microsoft sign-in or your IMAP server and application-specific password. Credentials are encrypted for this Windows user.</p>
        <label for="mail-provider">Email provider</label>
        <select id="mail-provider" ${hasAccount ? 'disabled' : ''}>
          <option value="google" ${providerForHost(mailHost) === 'google' ? 'selected' : ''}>Google / Gmail</option>
          <option value="outlook" ${providerForHost(mailHost) === 'outlook' ? 'selected' : ''}>Microsoft Outlook / Hotmail / Microsoft 365</option>
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
        ${repairOutlookHost ? '<p role="status">The saved server was an Outlook email domain. Save with Microsoft sign-in to correct it to outlook.office365.com.</p>' : ''}
        <button type="button" class="text-button" data-action="google-help" hidden>How to create a Google app password</button>
        <label for="mail-password">Application-specific password</label>
        <input id="mail-password" name="password" type="password" autocomplete="new-password" aria-describedby="provider-help" required>
        <div id="outlook-auth" hidden>
          <label for="outlook-client-id">Microsoft application (client) ID</label>
          <input id="outlook-client-id" name="client_id" type="text" placeholder="App registration client ID" aria-describedby="outlook-registration-help">
          <p id="outlook-registration-help">Use an app registration allowing personal and organizational accounts, public client flows, and delegated IMAP.AccessAsUser.All permission. This ID identifies the app; it is not your email password or an app password. No client secret is needed.</p>
          <button type="button" data-action="outlook-sign-in">Start Microsoft sign-in</button>
          <p id="outlook-sign-in-status" role="status"></p>
          <input name="device_code" type="hidden">
          <input name="device_interval" type="hidden" value="10">
        </div>
        <p id="setup-error" role="alert"></p>
        <div class="dialog-actions"><button type="button" class="ghost" data-action="cancel-setup">Cancel</button><button class="primary" type="submit">Save mailbox</button></div>
      </form>
    </dialog>
    <dialog id="remove-mailbox-dialog" aria-labelledby="remove-mailbox-title" aria-describedby="remove-mailbox-description">
      <form id="remove-mailbox-form">
        <h2 id="remove-mailbox-title">Remove mailbox?</h2>
        <p><strong>${escapeHtml(dashboard.user)}</strong></p>
        <p id="remove-mailbox-description">Remove this mailbox, its saved sign-in, and its backup schedule from Bmail. Local emails will be kept in a separate retained-data folder. Adding the mailbox again starts a new profile. Server emails stay untouched.</p>
        <p id="remove-mailbox-error" role="alert"></p>
        <div class="dialog-actions"><button type="button" class="ghost" data-action="cancel-remove-mailbox" autofocus>Cancel</button><button type="submit" class="danger-button">Remove mailbox</button></div>
      </form>
    </dialog>
  `;
  updateProviderHelp();
  if (activeTab === 'scheduler') initializeSchedulerView();
  notificationCenter.mount();
}

function toast(message, isError = false, account = dashboard?.user || '') {
  notificationCenter.notify(message, { level: isError ? 'error' : 'success', account });
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
    if (force) savedMail.key = '';
    next.newMailFolders = [...(newMailByAccount.get(next.user)?.keys() || [])];
    const unchanged = JSON.stringify(next) === JSON.stringify(dashboard);
    const finishedBackup = dashboard?.user === next.user && dashboard.backupRunning && !next.backupRunning;
    dashboard = next;
    if (finishedBackup) {
      const run = next.lastRun || {};
      const outcome = ['stopped', 'cancelled'].includes(next.progress?.state) ? next.progress.state : run.outcome || (run.success ? 'completed' : 'failed');
      const message = outcome === 'completed' ? `Backup completed. ${run.downloaded || next.progress?.downloaded || 0} emails saved.`
        : outcome === 'failed' ? `Backup failed. ${userMessage(run.error)}` : `Backup ${outcome}. Saved mail is kept.`;
      notificationCenter.notify(message, { level: outcome === 'failed' ? 'error' : outcome === 'completed' ? 'success' : 'info', key: `backup:${run.runId || next.progress?.runId || run.finishedAt}:${outcome}` });
    }
    updateBackupControls();
    updateBackupProgress();
    updateStatusBar();
    if (background && (columnResizeActive() || paneResizeActive() || unchanged || ['options','scheduler'].includes(activeTab) || document.querySelector('dialog[open]'))) return;
    captureTabDraft();
    const focusAction = document.activeElement?.dataset?.action;
    const focusFolder = document.activeElement?.dataset?.folder;
    const focusTab = document.activeElement?.dataset?.tab;
    const focusColumn = document.activeElement?.dataset?.column;
    const filterInput = document.activeElement?.id === 'folder-filter' ? document.activeElement : null;
    const previousReader = document.querySelector('#view-mailbox .reading-pane');
    const previousMessage = selectedMessage;
    const scrollPositions = [...document.querySelectorAll('.folder-list, .mail-workspace, .inspector, .table-wrap')].map(el => el.scrollTop);
    render();
    if (previousReader && selectedMessage === previousMessage) document.querySelector('.reading-pane')?.replaceWith(previousReader);
    document.querySelectorAll('.folder-list, .mail-workspace, .inspector, .table-wrap').forEach((el, index) => el.scrollTop = scrollPositions[index] || 0);
    if (filterInput) { document.querySelector('#folder-filter').replaceWith(filterInput); filterInput.focus({ preventScroll: true }); }
    if (focusAction === 'select-folder') [...document.querySelectorAll('[data-action="select-folder"]')].find(el => el.dataset.folder === focusFolder)?.focus({ preventScroll: true });
    if (focusAction === 'select-tab') document.querySelector(`#tab-${focusTab}`)?.focus({ preventScroll: true });
    if (focusAction === 'sort-mail') document.querySelector(`[data-action="sort-mail"][data-column="${focusColumn}"]`)?.focus({ preventScroll: true });
    if (focusAction && !['select-folder','select-tab','sort-mail'].includes(focusAction)) [...document.querySelectorAll('[data-action]')].find(el => el.dataset.action === focusAction)?.focus({ preventScroll: true });
  } catch (error) {
    if (!background) app.innerHTML = `${startupHeader(logoUrl)}<main class="fatal"><h1>Bmail could not start</h1><p>${escapeHtml(userMessage(error))}</p><button data-action="refresh">Retry startup</button></main>`;
  } finally { refreshing = false; finished(); dashboardPoller?.reschedule(); void checkStartupMail(); }
}

async function run(action) {
  if (busy) return;
  busy = true;
  busyAction = action;
  captureTabDraft();
  operationFailure = null;
  render();
  let message;
  let failed = false;
  try {
    message = action === 'backup' ? await invoke('start_backup') : await invoke('run_action', { action });
  } catch (error) {
    message = userMessage(error);
    failed = true;
    operationFailure = { action, message };
  } finally {
    busy = false;
    busyAction = '';
    await refresh();
    if (!failed && action === 'stats') { rememberNewMail(dashboard.mailboxStatus); render(); }
    toast(failed ? (action === 'stats' ? 'Mailbox check failed. See the error above.' : 'Action failed. See the error above.') : message, failed);
  }
}

app.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (notificationCenter.handle(action, button)) return;
  if (action.startsWith('window-')) { void controlWindow(action).catch(error => toast(userMessage(error), true)); return; }
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
  if (busy && ['select-tab','select-folder','selection','schedule','reset-selection','schedule-day','schedule-prev','schedule-next'].includes(action)) return;
  if (action === 'retry-preferences') { void loadDesktopPreferences(); return; }
  if (action === 'navigate-back' || action === 'navigate-forward') { moveNavigation(action === 'navigate-back' ? -1 : 1); return; }
  if (action === 'new-mail') { startupMailChecked.delete(dashboard.user); newMailRetryAfter.delete(dashboard.user); checkStartupMail(); return; }
  if (action === 'select-message') { openMessage(button.dataset.file, button.dataset.id); return; }
  if (action === 'retry-message') { openMessage(selectedMessage.file); return; }
  if (action === 'retry-mail') { savedMail.key = ''; render(); return; }
  if (action === 'mail-page') {
    if (savedMail.loading) return;
    mailPage = Number(button.dataset.page);
    reloadMailList(`[data-action="mail-page"][aria-label="${button.getAttribute('aria-label')}"]`);
    return;
  }
  if (action === 'sort-mail') {
    const column = button.dataset.column;
    if (!['subject', 'sender', 'folder', 'sentAt', 'bytes'].includes(column)) return;
    mailSort = { column, direction: mailSort.column === column && mailSort.direction === 'asc' ? 'desc' : 'asc' };
    mailPage = 1;
    reloadMailList(`[data-action="sort-mail"][data-column="${column}"]`);
    return;
  }
  if (action === 'select-tab') { selectTab(button.dataset.tab); return; }
  if (action === 'reset-selection') { backupOptionsDraft = null; render(); return; }
  if (action === 'schedule-load-folders') { loadScheduledFolders(button); return; }
  if (action === 'test-notification') { testNotification(button); return; }
  if (action === 'history-select') { selectedHistoryRun = button.dataset.runId; render(); [...document.querySelectorAll('.history-table button[data-action="history-select"]')].find(element => element.dataset.runId === selectedHistoryRun)?.focus({ preventScroll: true }); return; }
  if (action === 'schedule') { selectTab('scheduler'); return; }
  if (action === 'schedule-read') { scheduleOperation('read'); return; }
  if (action === 'schedule-remove') { scheduleOperation('remove'); return; }
  if (action === 'schedule-prev' || action === 'schedule-next') { schedulerMonth = new Date(schedulerMonth.getFullYear(), schedulerMonth.getMonth() + (action === 'schedule-next' ? 1 : -1), 1); schedulerFocusDate = localDate(schedulerMonth); updateSchedulePreview(); return; }
  if (action === 'schedule-day') { const date = button.dataset.date; document.querySelector('#schedule-date').value = date; schedulerFocusDate = date; schedulerMonth = new Date(`${date}T00:00:00`); updateSchedulePreview(); document.querySelector(`.schedule-calendar [data-date="${date}"]`)?.focus(); return; }
  if (action === 'download-email' || action === 'download-folder') {
    if (button.disabled) return;
    const exportAccount = dashboard.user;
    button.disabled = true;
    activeExports++;
    updateStatusBar();
    invoke('export_mail', { folder: button.dataset.folder || null, file: button.dataset.file || null })
      .then(message => { if (message) toast(message, false, exportAccount); })
      .catch(error => toast(userMessage(error), true, exportAccount))
      .finally(() => { activeExports--; updateStatusBar(); button.disabled = false; });
    return;
  }
  if (action === 'select-folder') { captureTabDraft(); rememberNavigation('mailbox', button.dataset.folder); selectedFolder = button.dataset.folder; activeTab = 'mailbox'; render(); return; }
  if (action === 'dismiss-error') { operationFailure = null; render(); return; }
  if (action === 'setup') { captureTabDraft(); document.querySelector('#mailbox-dialog').showModal(); }
  else if (action === 'remove-mailbox') {
    if (busy || dashboard.backupRunning || activeExports) return;
    document.querySelector('#remove-mailbox-error').textContent = '';
    document.querySelector('#remove-mailbox-dialog').showModal();
  }
  else if (action === 'cancel-remove-mailbox') document.querySelector('#remove-mailbox-dialog').close();
  else if (action === 'add-account') { captureTabDraft(); addingAccount = true; render(); document.querySelector('#mailbox-dialog').showModal(); }
  else if (['pause', 'resume', 'stop', 'cancel'].includes(action)) controlBackup(action, button.dataset.runId);
  else if (action === 'selection') selectTab('options');
  else if (action === 'load-folders') loadFolders();
  else if (action === 'outlook-sign-in') startOutlookSignIn(button);
  else if (action === 'google-help') invoke('open_google_help').catch(error => toast(userMessage(error), true));
  else if (action === 'cancel-setup') {
    document.querySelector('#mail-password').value = '';
    document.querySelector('#mailbox-dialog').close();
    addingAccount = false;
    render();
  }
  else if (action === 'refresh') refresh(false, true);
  else if (action.startsWith('open-')) invoke('open_directory', { kind: action.slice(5) }).catch(error => toast(userMessage(error), true));
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
  folderFilter = event.target.value;
  const navigation = document.querySelector('.folder-list');
  // Keep the search input, forms, clock and other workspace nodes intact.
  navigation.querySelectorAll('[data-folder]:not([data-folder=""]), .sidebar-empty').forEach(node => node.remove());
  navigation.insertAdjacentHTML('beforeend', folderNavigation(dashboard, selectedFolder, folderFilter, escapeHtml, formatNumber, mailIndicators()) || '<p class="sidebar-empty">No matching folders.</p>');

});

app.addEventListener('change', event => {
  if (event.target.id === 'mail-page-size') {
    mailPageSize = Number(event.target.value);
    mailPage = 1;
    try { localStorage.setItem('bmail-mail-page-size', String(mailPageSize)); } catch {}
    reloadMailList('#mail-page-size');
    return;
  }
  if (event.target.id === 'close-behavior') { void saveCloseBehavior(event.target.value); return; }
  if (event.target.id === 'font-family-preference' || event.target.id === 'font-size-preference') {
    setAppearance(event.target.id === 'font-family-preference' ? { fontFamily: event.target.value } : { fontSize: Number(event.target.value) });
    updateReader();
    toast('Font preference saved.');
    return;
  }
  if (event.target.id === 'email-image-preference') { setAppearance({ imageMode: event.target.value }); updateReader(); toast('Image preference saved.'); return; }
  if (event.target.id === 'theme-preference') { setTheme(event.target.value); return; }
  if (event.target.id === 'history-filter') { historyFilter = event.target.value; render(); return; }
  if (event.target.closest('#scheduler-form')) { updateSchedulePreview(); return; }
  if (event.target.id === 'active-account') switchAccount(event.target.value);
  if (event.target.id === 'all-folders') {
    document.querySelector('#folder-choices').disabled = event.target.checked;
  }
  if (event.target.id === 'outlook-client-id' || event.target.id === 'mail-provider') {
    document.querySelector('[name="device_code"]').value = '';
    document.querySelector('#outlook-sign-in-status').textContent = '';
  }
  if (event.target.id === 'mail-provider') {
    const provider = event.target.value;
    document.querySelector('#mail-host').value = provider === 'google' ? 'imap.gmail.com' : provider === 'outlook' ? 'outlook.office365.com' : provider === 'zoho' ? 'imappro.zoho.in' : '';
    document.querySelector('#mail-port').value = '993';
    updateProviderHelp();
  } else if (event.target.id === 'mail-host') {
    if (outlookAddressHost(event.target.value)) event.target.value = 'outlook.office365.com';
    document.querySelector('#mail-provider').value = providerForHost(event.target.value.trim());
    updateProviderHelp();
  }
});

app.addEventListener('cancel', event => {
    if (event.target.id === 'mailbox-dialog' && !busy) {
    document.querySelector('#mail-password').value = '';
    document.querySelector('[name="device_code"]').value = '';
    document.querySelector('#outlook-sign-in-status').textContent = '';
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
  } catch (error) { document.querySelector('#selection-error').textContent = userMessage(error); }
  finally { busy = false; button.disabled = submit.disabled = false; button.textContent = 'Load / refresh mailbox folders'; }
}

async function controlBackup(command, runId) {
  if (controlBusy) return;
  controlBusy = true;
  updateBackupControls();
  try {
    const result = await invoke('control_backup', { command, runId });
    await refresh();
    toast(result);
  } catch (error) { toast(userMessage(error), true); await refresh(); }
  finally { controlBusy = false; updateBackupControls(); }
}

async function removeMailbox() {
  if (busy || dashboard.backupRunning || activeExports) return;
  const email = dashboard.user;
  const dialog = document.querySelector('#remove-mailbox-dialog');
  const controls = [...dialog.querySelectorAll('button')];
  const preventCancel = event => event.preventDefault();
  busy = true;
  dialog.addEventListener('cancel', preventCancel);
  controls.forEach(control => control.disabled = true);
  dialog.querySelector('[type="submit"]').textContent = 'Removing...';
  document.querySelector('#remove-mailbox-error').textContent = '';
  try {
    const message = await invoke('remove_mailbox', { email });
    dialog.close();
    if (document.querySelector('#mailbox-dialog').open) document.querySelector('#mailbox-dialog').close();
    notificationCenter.clearAccount(email);
    startupMailChecked.delete(email); newMailRetryAfter.delete(email); newMailByAccount.delete(email);
    addingAccount = false; operationFailure = null;
    selectedFolder = ''; folderFilter = ''; selectedHistoryRun = '';
    selectedMessage = { file: '', message: null, loading: false, error: '' };
    savedMail = { key: '', rows: [], loading: false, error: '' };
    activeTab = 'mailbox'; backupOptionsDraft = schedulerDraft = null; schedulerLoaded = false; schedulerFocusDate = '';
    resetNavigation();
    busy = false;
    await refresh(false, true);
    toast(message);
  } catch (error) {
    document.querySelector('#remove-mailbox-error').textContent = userMessage(error);
  } finally {
    busy = false;
    dialog.removeEventListener('cancel', preventCancel);
    controls.forEach(control => control.disabled = false);
    dialog.querySelector('[type="submit"]').textContent = 'Remove mailbox';
    dashboardPoller?.reschedule();
  }
}

async function switchAccount(email) {
  if (busy || dashboard.backupRunning) return;
  busy = true;
  operationFailure = null;
  selectedFolder = '';
  folderFilter = '';
  selectedHistoryRun = '';
  activeTab = 'mailbox'; backupOptionsDraft = schedulerDraft = null; schedulerLoaded = false; schedulerFocusDate = '';
  resetNavigation();
  render();
  try { await invoke('switch_account', { email }); }
  catch (error) { toast(userMessage(error), true); }
  finally { busy = false; await refresh(); }
}

async function testNotification(button) {
  if (busy) return;
  busy = true;
  button.disabled = true;
  button.textContent = 'Sending test...';
  try { document.querySelector('#notification-status').textContent = await invoke('test_notification'); }
  catch (error) { document.querySelector('#selection-error').textContent = userMessage(error); }
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
  document.querySelector('#schedule-folder-choices').disabled = draft.allFolders;
  form.querySelectorAll('[data-recurrence]').forEach(element => {
    element.hidden = !element.dataset.recurrence.split(' ').includes(draft.frequency);
    element.querySelectorAll('input,select').forEach(input => input.disabled = element.hidden);
  });
  document.querySelector('#schedule-every').max = draft.frequency === 'weekly' ? 52 : 365;
  let schedule;
  try { schedule = normalizeSchedule(draft); document.querySelector('#schedule-error').textContent = ''; }
  catch (error) { document.querySelector('#schedule-error').textContent = userMessage(error); schedule = { ...draft, enabled: false }; }
  document.querySelector('#schedule-calendar').innerHTML = calendarMarkup(schedule, schedulerMonth, schedulerFocusDate, escapeHtml);
  const runs = nextRuns(schedule);
  document.querySelector('#schedule-upcoming').innerHTML = `<h3>Upcoming preview</h3>${runs.length ? `<ol>${runs.map(date => `<li>${formatDate(date)}</li>`).join('')}</ol>` : '<p>No upcoming runs for these settings.</p>'}<p class="muted">Preview only. Windows next-run status is authoritative. Dots are planned dates, not completed backups.</p>`;
  updateClock();
}

function readBackupOptions(form) {
  const values = new FormData(form);
  return { folders: form.elements.allFolders.checked ? [] : values.getAll('folders'), dateFrom: values.get('dateFrom') || null,
    dateTo: values.get('dateTo') || null, maxMessages: values.get('maxMessages') ? Number(values.get('maxMessages')) : null,
    advanced: advancedFromForm(values), _uiAllFolders: form.elements.allFolders.checked };
}

function captureTabDraft() {
  const options = document.querySelector('#selection-form');
  if (activeTab === 'options' && options) backupOptionsDraft = { ...readBackupOptions(options), _uiAdvancedOpen: options.querySelector('.advanced-backup').open };
  const scheduler = document.querySelector('#scheduler-form');
  if (activeTab === 'scheduler' && scheduler) schedulerDraft = { ...scheduleFromForm(scheduler), _uiAdvancedOpen: scheduler.querySelector('.scheduler-advanced').open };
}

function initializeSchedulerView() {
  const date = document.querySelector('#schedule-date').value;
  if (!schedulerFocusDate) { schedulerFocusDate = date; schedulerMonth = new Date(`${date}T00:00:00`); }
  updateSchedulePreview(); updateScheduleStatus();
}

async function selectTab(tab, remember = true) {
  if (busy || !workspaceTabs.some(([key]) => key === tab)) return;
  captureTabDraft();
  if (remember) rememberNavigation(tab);
  activeTab = tab;
  render();
  document.querySelector(`#tab-${tab}`)?.focus({ preventScroll: true });
  if (tab === 'scheduler' && !schedulerLoaded && dashboard.credentialReady) await scheduleOperation('read', !schedulerDraft);
}

async function loadScheduledFolders(button) {
  if (busy || dashboard.backupRunning) return;
  busy = true;
  button.disabled = true; button.textContent = 'Loading folders...';
  const selected = [...document.querySelectorAll('[name="scheduledFolders"]:checked')].map(input => input.value);
  const controls = [...document.querySelectorAll('#scheduler-form button,#scheduler-form input,#scheduler-form select')].filter(control => !control.disabled);
  controls.forEach(control => control.disabled = true);
  try {
    await invoke('run_action', { action: 'folders' });
    const updated = await invoke('get_dashboard', { force: false });
    dashboard.mailboxes = updated.mailboxes;
    document.querySelector('#schedule-folder-options').innerHTML = scheduleFolderChoices(dashboard, selected, document.querySelector('#schedule-all-folders').checked, escapeHtml);
    document.querySelector('#schedule-error').textContent = '';
  } catch (error) { document.querySelector('#schedule-error').textContent = userMessage(error); }
  finally { busy = false; controls.forEach(control => control.disabled = false); button.disabled = false; button.textContent = 'Load / refresh scheduled folders'; dashboardPoller?.reschedule(); }
}

async function scheduleOperation(action, loadSettings = false) {
  if (schedulerBusy || busy) return;
  const form = document.querySelector('#scheduler-form');
  if (action !== 'read' && dashboard.backupRunning) { document.querySelector('#schedule-error').textContent = 'Finish the current backup before changing its schedule.'; return; }
  let replaceForm = false;
  let schedule;
  try { if (action === 'save') schedule = normalizeSchedule(scheduleFromForm(form)); }
  catch (error) { document.querySelector('#schedule-error').textContent = userMessage(error); return; }
  schedulerBusy = true; busy = true;
  document.querySelector('#schedule-error').textContent = '';
  const controls = [...form.querySelectorAll('button,input,select')];
  const enabled = controls.filter(control => !control.disabled);
  enabled.forEach(control => control.disabled = true);
  try {
    const result = await invoke('manage_schedule', { action, schedule: schedule || null });
    dashboard.schedule = result; dashboard.scheduleInstalled = result.installed; schedulerLoaded = true;
    // Preserve draft edits on a status refresh. Save/remove replace the form
    // only after Windows confirms the operation succeeded.
    replaceForm = action !== 'read' || loadSettings;
    updateScheduleStatus();
    if (action === 'save') toast(result.enabled ? 'Schedule saved in Windows.' : 'Schedule paused.');
    if (action === 'remove') toast('Schedule removed. Backup files are kept.');
  } catch (error) { document.querySelector('#schedule-error').textContent = userMessage(error); }
  finally {
    schedulerBusy = false; busy = false;
    enabled.forEach(control => control.disabled = false);
    if (replaceForm) {
      schedulerDraft = null; schedulerFocusDate = '';
      render();
    }
    updateScheduleStatus();
    dashboardPoller?.reschedule();
  }
}

app.addEventListener('keydown', event => {
  const tab = event.target.closest('[role="tab"]');
  if (tab && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
    if (busy) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs.forEach((button, i) => button.tabIndex = i === next ? 0 : -1);
    tabs[next].focus(); return;
  }
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
  if (event.target.id === 'remove-mailbox-form') { event.preventDefault(); await removeMailbox(); return; }
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
      backupOptionsDraft = null;
      busy = false;
      await refresh();
      toast(result);
    } catch (error) { document.querySelector('#selection-error').textContent = userMessage(error); }
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
    port: Number(values.get('port')), password: values.get('password') || '',
    client_id: values.get('client_id')?.trim() || '', device_code: values.get('device_code') || '',
    device_interval: Number(values.get('device_interval')) || 10,
  };
  if (outlookHost(settings.host) && !settings.device_code) {
    document.querySelector('#setup-error').textContent = 'Start Microsoft sign-in first.';
    return;
  }
  busy = true;
  const dialog = document.querySelector('#mailbox-dialog');
  const preventCancel = event => event.preventDefault();
  dialog.addEventListener('cancel', preventCancel);
  const enabledControls = [...form.querySelectorAll('button, input, select')].filter(element => !element.disabled);
  enabledControls.forEach(element => element.disabled = true);
  form.querySelector('[type="submit"]').textContent = outlookHost(settings.host) ? 'Waiting for Microsoft approval...' : 'Saving...';
  document.querySelector('#setup-error').textContent = '';
  try {
    const result = await invoke('configure_mailbox', { settings });
    addingAccount = false;
    activeTab = 'mailbox'; backupOptionsDraft = schedulerDraft = null; schedulerLoaded = false; schedulerFocusDate = '';
    selectedFolder = ''; folderFilter = ''; resetNavigation();
    busy = false;
    dialog.close();
    await refresh();
    toast(result);
  } catch (error) {
    document.querySelector('#setup-error').textContent = userMessage(error);
    document.querySelector('#setup-error').scrollIntoView({ block: 'nearest' });
  } finally {
    settings.password = '';
    settings.device_code = '';
    form.querySelector('[name="device_code"]').value = '';
    values.delete('password');
    form.querySelector('[name="password"]').value = '';
    enabledControls.forEach(element => element.disabled = false);
    form.querySelector('[type="submit"]').textContent = 'Save mailbox';
    dialog.removeEventListener('cancel', preventCancel);
    busy = false;
  }
});

installGlobalErrorHandlers(window, message => {
  if (!document.querySelector('#toast')) {
    app.innerHTML = `${startupHeader(logoUrl)}<main class="fatal" role="alert"><h1>Bmail needs your attention</h1><p>${escapeHtml(message)}</p><button data-action="refresh">Retry</button></main>`;
    return;
  }
  notificationCenter.notify(message, { level: 'error', key: `unexpected:${message}` });
});

dashboardPoller = createDashboardPoller({
  refresh: () => refresh(true),
  state: () => ({ hidden: document.hidden && !desktopPreferences?.closeToTray, busy, controlBusy, backupRunning: Boolean(dashboard?.backupRunning) }),
});
document.addEventListener('visibilitychange', () => dashboardPoller.wake());
window.addEventListener('pagehide', () => dashboardPoller.stop());
installColumnResizing(app);
installPaneResizing(app);
render();
Promise.all([refresh(), loadDesktopPreferences()]).finally(() => {
  dashboardPoller.start();
  void invoke('finish_startup').catch(error => console.error('Could not finish startup:', error));
});
setInterval(updateClock, 1000);
