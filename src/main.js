import './style.css';
import { invoke } from '@tauri-apps/api/core';

const app = document.querySelector('#app');
let dashboard;
let busy = false;

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
      <div class="brand"><span class="brand-mark">M</span><div><strong>Mail Vault</strong><small>Local Zoho backup</small></div></div>
      <button class="ghost" data-action="refresh" ${busy ? 'disabled' : ''}>Refresh</button>
    </header>
    <main>
      <section class="hero ${state}">
        <div class="status-icon">${healthy ? '✓' : run ? '!' : '→'}</div>
        <div class="hero-copy">
          <p class="eyebrow">${escapeHtml(dashboard.user)}</p>
          <h1>${statusTitle}</h1>
          <p>${run ? `Last finished ${formatDate(run.finishedAt)} · ${formatNumber(run.downloaded)} new messages` : 'Your encrypted credential and first backup can be created with the existing setup script.'}</p>
        </div>
        <button class="primary" data-action="backup" ${busy || !dashboard.credentialReady ? 'disabled' : ''}>
          ${busy ? '<span class="spinner small"></span>Working…' : 'Back up now'}
        </button>
      </section>

      ${!dashboard.credentialReady ? `<aside class="notice"><strong>Setup required.</strong> Run <code>Setup-Backup.cmd</code> once to save your app password securely, then return here.</aside>` : ''}
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
  `;
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
  try {
    const result = await invoke('run_action', { action });
    toast(result);
  } catch (error) {
    toast(String(error), true);
  } finally {
    busy = false;
    await refresh();
  }
}

app.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'refresh') refresh();
  else if (action.startsWith('open-')) invoke('open_directory', { kind: action.slice(5) }).catch(error => toast(String(error), true));
  else run(action);
});

render();
refresh();
