import messages from '../engine/drive-messages.json';
import dropboxMessages from '../engine/dropbox-messages.json';
import driveIcon from './assets/providers/google-drive.png';
import dropboxIcon from './assets/providers/dropbox.svg';

function providerView(provider, status, { pending = '', backupRunning = false, ready = true, error = '' } = {}, escape, date) {
  status ||= {};
  const google = provider === 'drive';
  const name = google ? 'Google Drive' : 'Dropbox';
  const id = google ? 'cloud-backup-settings' : 'dropbox-backup-settings';
  const prefix = google ? 'cloud' : 'dropbox';
  const account = google ? status.driveAccount : status.dropboxAccount;
  const working = Boolean(pending || ['connecting', 'uploading'].includes(status.stage));
  const uploading = pending === 'sync' || status.stage === 'uploading';
  const label = working ? uploading ? 'Uploading' : pending === 'automatic' ? 'Saving' : pending === 'disconnect' ? 'Disconnecting' : pending === 'setup' ? 'Setting up' : 'Connecting' : status.connected ? 'Connected' : 'Not connected';
  const disabled = working || !ready ? 'disabled' : '';
  const total = Number(status.totalFiles) || 0, completed = Number(status.completedFiles) || 0, bytes = Number(status.totalBytes) || 0;
  const percent = Math.min(100, Math.round(bytes ? (Number(status.uploadedBytes) || 0) / bytes * 100 : total ? completed / total * 100 : 0));
  const problem = error || (google ? messages : dropboxMessages)[status.errorCode];
  const connect = google && !status.configured ? 'setup' : 'connect';
  const connectLabel = google && !status.configured ? 'Set up Google Drive' : `Connect ${name}`;
  const uploadLabel = google ? 'Back up to Drive now' : 'Back up to Dropbox now';
  return `<article id="${id}" class="cloud-backup" aria-labelledby="${prefix}-provider-title">
    <header class="cloud-provider"><img src="${google ? driveIcon : dropboxIcon}" alt="" width="32" height="32"><h4 id="${prefix}-provider-title">${name}</h4><span class="cloud-connection" role="status">${label}</span></header>
    ${!ready ? '<p class="cloud-required">Set up a mailbox first.</p>' : !google && !status.configured ? '<p class="cloud-required">Unavailable in this build.</p>' : ''}
    ${status.connected && account ? `<p class="cloud-account">${escape(account)}</p>` : ''}
    ${status.lastSyncedAt ? `<dl class="cloud-details"><div><dt>Last backup</dt><dd>${escape(date(status.lastSyncedAt))}</dd></div></dl>` : ''}
    ${status.folderName ? `<details class="cloud-folder"><summary>Backup folder</summary><p>${escape(status.folderName)}</p></details>` : ''}
    ${pending === 'setup' ? '<p role="status">Choose your Google OAuth client JSON.</p>' : pending === 'connect' || status.stage === 'connecting' ? '<p role="status">Finish sign-in in your browser.</p>' : ''}
    ${uploading ? `<div class="cloud-progress" aria-live="polite"><progress max="100" ${total ? `value="${percent}"` : ''} aria-label="${name} backup progress"></progress><p>${total ? `${completed} / ${total} files` : 'Checking local files…'}</p></div>` : ''}
    ${problem ? `<p class="preferences-error" role="alert">${escape(problem)}</p>` : ''}
    <div class="cloud-actions">${status.connected ? `<button type="button" class="primary" data-action="${prefix}-sync" ${disabled || backupRunning ? 'disabled' : ''}>${uploading ? google ? 'Uploading…' : 'Uploading to Dropbox…' : uploadLabel}</button><button type="button" data-action="${prefix}-disconnect" ${disabled}>${google ? 'Disconnect' : 'Disconnect Dropbox'}</button>` : `<button type="button" class="primary" data-action="${prefix}-${connect}" ${disabled || !google && !status.configured ? 'disabled' : ''}>${connectLabel}</button>`}
      ${google && !status.connected ? `${status.configured ? `<button type="button" data-action="cloud-setup" ${disabled}>Change app setup</button>` : ''}<button type="button" data-action="cloud-guide" ${working ? 'disabled' : ''}>Setup guide</button>` : ''}
    </div>
    <label class="cloud-automatic"><input type="checkbox" id="${google ? 'cloud' : 'dropbox'}-automatic" aria-label="${google ? 'Upload to Drive after successful local backups' : 'Upload to Dropbox after successful local backups'}" ${status.automatic ? 'checked' : ''} ${disabled || !status.connected ? 'disabled' : ''}>Upload after local backups</label>
  </article>`;
}

export const cloudBackupView = (status, options, escape, date) => providerView('drive', status, options, escape, date);
export const dropboxBackupView = (status, options, escape, date) => providerView('dropbox', status, options, escape, date);
