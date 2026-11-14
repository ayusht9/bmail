import './style.css';
import { invoke } from '@tauri-apps/api/core';

const app = document.querySelector('#app');
let dashboard;
let busy = false;

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
  const healthy = run?.success === true;
  const state = healthy ? 'healthy' : run ? 'attention' : 'empty';
  const statusTitle = healthy ? 'Backup is healthy' : run ? 'Last run needs attention' : 'Ready for the first backup';
  const folderRows = (run?.folders || []).map(folder => `
    <tr><td>${escapeHtml(folder.name)}</td><td>${formatNumber(folder.verified)} / ${formatNumber(folder.serverMessages)}</td><td>${formatNumber(folder.downloaded)}</td></tr>
  `).join('');

  app.innerHTML = `
    <header>
      <div class="brand"><span class="brand-mark">M</span><div><strong>Mail Vault</strong><small>Local email backup</small></div></div>
      <button class="ghost" data-action="refresh" ${busy ? 'disabled' : ''}>Refresh</button>
    </header>
    <main>
      <section class="hero ${state}">
        <div class="status-icon">${healthy ? '✓' : run ? '!' : '→'}</div>
        <div class="hero-copy">
          <p class="eyebrow">${escapeHtml(dashboard.user)}</p>
          <h1>${statusTitle}</h1>
          <p>${run ? `Last finished ${formatDate(run.finishedAt)} · ${formatNumber(run.downloaded)} new messages` : dashboard.credentialReady ? 'Your mailbox is ready. Start your first backup.' : 'Set up your mailbox, then start your first backup.'}</p>
        </div>
        <button class="primary" data-action="backup" ${busy || !dashboard.credentialReady ? 'disabled' : ''}>
          ${busy ? '<span class="spinner small"></span>Working…' : 'Back up now'}
        </button>
      </section>

      ${!dashboard.credentialReady ? `<aside class="notice"><strong>Set up your mailbox.</strong> Save your IMAP account and app password to start backing up. <button class="ghost" data-action="setup" ${busy ? 'disabled' : ''}>Set up mailbox</button></aside>` : ''}
      ${run?.error ? `<aside class="notice error"><strong>${escapeHtml(run.error.message || 'Backup failed')}</strong><span>No server email was deleted. Completed downloads are retained.</span></aside>` : ''}

      <section class="metrics">
        <article><span>Saved messages</span><strong>${formatNumber(dashboard.totalMessages)}</strong><small>verified in the manifest</small></article>
        <article><span>Mailbox folders</span><strong>${formatNumber(dashboard.folderCount)}</strong><small>preserved locally</small></article>
        <article><span>Schedule</span><strong class="schedule">Monday · 11:00</strong><small>${dashboard.scheduleInstalled ? 'Windows task is installed' : 'not installed yet'}</small></article>
      </section>

      <section class="workspace">
        <article class="panel coverage">
          <div class="panel-head"><div><p class="eyebrow">Coverage</p><h2>Mailbox folders</h2></div><button class="text-button" data-action="open-backups">Open backup folder</button></div>
          ${folderRows ? `<div class="table-wrap"><table><thead><tr><th>Folder</th><th>Verified</th><th>New</th></tr></thead><tbody>${folderRows}</tbody></table></div>` : '<p class="muted">Folder coverage appears after a backup run.</p>'}
        </article>
        <aside class="panel actions">
          <p class="eyebrow">Maintenance</p><h2>Tools</h2>
          <button data-action="setup" ${busy ? 'disabled' : ''}><span>${dashboard.credentialReady ? 'Update app password' : 'Set up mailbox'}</span><small>Encrypted for your Windows account</small></button>
          <button data-action="verify" ${busy || !dashboard.hasManifest ? 'disabled' : ''}><span>Verify local files</span><small>Check hashes without connecting</small></button>
          <button data-action="schedule" ${busy || !dashboard.credentialReady ? 'disabled' : ''}><span>${dashboard.scheduleInstalled ? 'Update schedule' : 'Install schedule'}</span><small>Weekly, Monday at 11:00</small></button>
          <button data-action="open-logs"><span>Open log folder</span><small>${dashboard.latestLog ? escapeHtml(dashboard.latestLog.name) : 'No logs yet'}</small></button>
        </aside>
      </section>

      <section class="panel log-panel">
        <div class="panel-head"><div><p class="eyebrow">Latest activity</p><h2>${dashboard.latestLog ? escapeHtml(dashboard.latestLog.name) : 'No log available'}</h2></div></div>
        <pre>${escapeHtml(dashboard.latestLog?.tail || 'Run a backup to see activity here.')}</pre>
      </section>
    </main>
    <footer>Read-only IMAP backup · Mail Vault never deletes server email</footer>
    <div id="toast" role="status"></div>
    <dialog id="mailbox-dialog" aria-labelledby="setup-title" aria-describedby="setup-description">
      <form id="mailbox-form">
        <h2 id="setup-title">${dashboard.credentialReady ? 'Update app password' : 'Set up your mailbox'}</h2>
        <p id="setup-description">Use your IMAP server and application-specific password. Your password is encrypted for this Windows user.</p>
        <label for="mail-provider">Email provider</label>
        <select id="mail-provider" ${dashboard.user.includes('@') ? 'disabled' : ''}>
          <option value="google" ${providerForHost(dashboard.host) === 'google' ? 'selected' : ''}>Google / Gmail</option>
          <option value="zoho" ${providerForHost(dashboard.host) === 'zoho' ? 'selected' : ''}>Zoho India</option>
          <option value="other" ${providerForHost(dashboard.host) === 'other' ? 'selected' : ''}>Other IMAP server</option>
        </select>
        <label for="mail-user">Email address</label>
        <input id="mail-user" name="user" type="email" autocomplete="username" value="${dashboard.user.includes('@') ? escapeHtml(dashboard.user) : ''}" ${dashboard.user.includes('@') ? 'readonly' : ''} required>
        <label for="mail-host">IMAP server</label>
        <input id="mail-host" name="host" type="text" value="${escapeHtml(dashboard.host)}" pattern="[a-zA-Z0-9.\\-]+" ${dashboard.user.includes('@') ? 'readonly' : ''} required>
        <label for="mail-port">TLS port</label>
        <input id="mail-port" name="port" type="number" min="1" max="65535" value="${dashboard.port}" ${dashboard.user.includes('@') ? 'readonly' : ''} required>
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

async function refresh() {
  try {
    dashboard = await invoke('get_dashboard');
    render();
  } catch (error) {
    app.innerHTML = `<main class="fatal"><h1>Mail Vault could not start</h1><p>${escapeHtml(error)}</p></main>`;
  }
}

async function run(action) {
  busy = true;
  render();
  let message;
  let failed = false;
  try {
    message = await invoke('run_action', { action });
  } catch (error) {
    message = String(error);
    failed = true;
  } finally {
    busy = false;
    await refresh();
    toast(message, failed);
  }
}

app.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'setup') document.querySelector('#mailbox-dialog').showModal();
  else if (action === 'google-help') invoke('open_google_help').catch(error => toast(String(error), true));
  else if (action === 'cancel-setup') {
    document.querySelector('#mail-password').value = '';
    document.querySelector('#mailbox-dialog').close();
  }
  else if (action === 'refresh') refresh();
  else if (action.startsWith('open-')) invoke('open_directory', { kind: action.slice(5) }).catch(error => toast(String(error), true));
  else run(action);
});

app.addEventListener('change', event => {
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
  if (event.target.id === 'mailbox-dialog' && !busy) {
    document.querySelector('#mail-password').value = '';
  }
}, true);

app.addEventListener('submit', async event => {
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

render();
refresh();
