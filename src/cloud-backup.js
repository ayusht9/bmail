import messages from '../engine/drive-messages.json';
import dropboxMessages from '../engine/dropbox-messages.json';

export function dropboxBackupView(status = {}, { pending = '', backupRunning = false, ready = true, error = '' } = {}, escape, date) {
  status ||= {};
  const working = Boolean(pending || ['connecting', 'uploading'].includes(status.stage));
  const uploading = pending === 'sync' || status.stage === 'uploading';
  const label = working ? uploading ? 'Uploading' : pending === 'automatic' ? 'Saving' : pending === 'disconnect' ? 'Disconnecting' : 'Connecting' : status.connected ? 'Connected' : 'Not connected';
  const disabled = working || !ready ? 'disabled' : '';
  const total = Number(status.totalFiles) || 0, completed = Number(status.completedFiles) || 0, bytes = Number(status.totalBytes) || 0;
  const percent = Math.min(100, Math.round(bytes ? (Number(status.uploadedBytes) || 0) / bytes * 100 : total ? completed / total * 100 : 0));
  const problem = error || dropboxMessages[status.errorCode];
  return `<section id="dropbox-backup-settings" class="preference-section cloud-backup" aria-labelledby="dropbox-backup-title">
    <header><h3 id="dropbox-backup-title">Dropbox backup</h3><span class="cloud-connection" role="status">${label}</span></header>
    <div class="cloud-provider"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18H6a4 4 0 0 1-.6-8A6.5 6.5 0 0 1 18 9a4.5 4.5 0 0 1 0 9h-1M12 21V12m-3 3 3-3 3 3"/></svg><div><strong>Dropbox</strong><p>Keep verified copies of your saved emails in Bmail’s Dropbox app folder.</p></div></div>
    ${!ready ? '<p>Set up a mailbox to connect Dropbox.</p>' : !status.configured ? '<p>Dropbox sign-in is not configured in this build.</p>' : ''}
    ${status.connected && status.dropboxAccount ? `<p>Connected as ${escape(status.dropboxAccount)}</p>` : ''}
    ${status.folderName ? `<p>Destination: <strong>${escape(status.folderName)}</strong> inside Bmail’s app folder</p>` : ''}
    ${status.lastSyncedAt ? `<p>Last Dropbox backup: ${escape(date(status.lastSyncedAt))}</p>` : ''}
    ${pending === 'connect' || status.stage === 'connecting' ? '<p role="status">Complete Dropbox sign-in in your browser, then return to Bmail. Sign-in expires after three minutes.</p>' : ''}
    ${uploading ? `<div class="cloud-progress" aria-live="polite"><progress max="100" ${total ? `value="${percent}"` : ''} aria-label="Dropbox backup progress"></progress><p>${total ? `${completed} of ${total} files checked` : 'Verifying saved emails…'}</p></div>` : ''}
    ${problem ? `<p class="preferences-error" role="alert">${escape(problem)}</p>` : ''}
    <div class="cloud-actions">${status.connected ? `<button type="button" class="primary" data-action="dropbox-sync" ${disabled || backupRunning ? 'disabled' : ''}>${uploading ? 'Uploading to Dropbox…' : 'Back up to Dropbox now'}</button><button type="button" data-action="dropbox-disconnect" ${disabled}>Disconnect Dropbox</button>` : `<button type="button" class="primary" data-action="dropbox-connect" ${disabled || !status.configured ? 'disabled' : ''}>Connect Dropbox</button>`}</div>
    <label class="cloud-automatic"><input type="checkbox" id="dropbox-automatic" ${status.automatic ? 'checked' : ''} ${disabled || !status.connected ? 'disabled' : ''}>Upload to Dropbox after successful local backups</label>
    <p class="cloud-note">Uploads email files and their manifest. Disconnecting keeps both your local and Dropbox backups.</p>
  </section>`;
}

export function cloudBackupView(status = {}, { pending = '', backupRunning = false, ready = true, error = '' } = {}, escape, date) {
  status ||= {};
  const working = Boolean(pending || ['connecting', 'uploading'].includes(status.stage));
  const uploading = pending === 'sync' || status.stage === 'uploading';
  const label = working ? uploading ? 'Uploading' : pending === 'setup' ? 'Setting up' : pending === 'automatic' ? 'Saving' : pending === 'disconnect' ? 'Disconnecting' : 'Connecting' : status.connected ? 'Connected' : 'Not connected';
  const disabled = working || !ready ? 'disabled' : '';
  const total = Number(status.totalFiles) || 0;
  const completed = Number(status.completedFiles) || 0;
  const totalBytes = Number(status.totalBytes) || 0;
  const percent = Math.min(100, Math.round(totalBytes ? (Number(status.uploadedBytes) || 0) / totalBytes * 100 : total ? completed / total * 100 : 0));
  const problem = error || messages[status.errorCode];
  return `<section id="cloud-backup-settings" class="preference-section cloud-backup" aria-labelledby="cloud-backup-title">
    <header><h3 id="cloud-backup-title">Cloud backup</h3><span class="cloud-connection" role="status">${label}</span></header>
    <div class="cloud-provider"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18H6a4 4 0 0 1-.6-8A6.5 6.5 0 0 1 18 9a4.5 4.5 0 0 1 0 9h-1M12 21V12m-3 3 3-3 3 3"/></svg><div><strong>Google Drive</strong><p>Keep a cloud copy of your saved emails and backup manifest.</p></div></div>
    ${!ready ? '<p>Set up a mailbox to connect Google Drive.</p>' : ''}
    ${status.connected && status.driveAccount ? `<p class="cloud-account">Connected as ${escape(status.driveAccount)}</p>` : ''}
    ${status.folderName ? `<p>Destination: <strong>${escape(status.folderName)}</strong></p>` : ''}
    ${status.lastSyncedAt ? `<p>Last cloud backup: ${escape(date(status.lastSyncedAt))}</p>` : ''}
    ${!status.configured ? '<p>Enable the Drive API and create a Desktop OAuth client in Google Cloud, then import the downloaded JSON file. You only need to do this once for this mailbox.</p>' : ''}
    ${pending === 'setup' ? '<p role="status">Choose the Google desktop client JSON file in the file picker.</p>' : pending === 'connect' || status.stage === 'connecting' ? '<p role="status">Complete sign-in in your browser, then return to Bmail. Sign-in expires after three minutes.</p>' : ''}
    ${uploading ? `<div class="cloud-progress" aria-live="polite"><progress max="100" ${total ? `value="${percent}"` : ''} aria-label="Google Drive backup progress"></progress><p>${total ? `${completed} of ${total} files checked` : 'Verifying saved emails…'}</p></div>` : ''}
    ${problem ? `<p class="preferences-error" role="alert">${escape(problem)}</p>` : ''}
    <div class="cloud-actions">
      ${!status.configured ? `<button type="button" class="primary" data-action="cloud-setup" ${disabled}>Set up Google Drive</button>` : !status.connected ? `<button type="button" class="primary" data-action="cloud-connect" ${disabled}>Connect Google Drive</button><button type="button" data-action="cloud-setup" ${disabled}>Change app setup</button>` : `<button type="button" class="primary" data-action="cloud-sync" ${disabled || backupRunning ? 'disabled' : ''}>${uploading ? 'Uploading…' : 'Back up to Drive now'}</button><button type="button" data-action="cloud-disconnect" ${disabled}>Disconnect</button>`}
      ${!status.connected ? `<button type="button" data-action="cloud-guide" ${working ? 'disabled' : ''}>Setup guide</button>` : ''}
    </div>
    <label class="cloud-automatic"><input type="checkbox" id="cloud-automatic" ${status.automatic ? 'checked' : ''} ${disabled || !status.connected ? 'disabled' : ''}>Upload to Drive after successful local backups</label>
    <p class="cloud-note">Uploads verified local copies. Existing Drive backups are kept when you disconnect. Cloud failures leave your local backups intact.</p>
  </section>`;
}
