export const formatBytes = (bytes = 0) => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB`
  : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
export const duration = seconds => {
  if (seconds == null || !Number.isFinite(seconds)) return 'Calculating...';
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : minutes ? `${minutes}m ${Math.floor(seconds % 60)}s` : `${Math.floor(seconds)}s`;
};

export function progressPanel(dashboard, escapeHtml, formatNumber) {
  const p = dashboard.progress;
  if (!p && !dashboard.backupRunning) return '';
  const active = dashboard.backupRunning;
  const fresh = p && !['completed', 'failed', 'stopped', 'cancelled'].includes(p.state);
  const phase = active ? fresh ? p.phase : p?.finishedAt || p?.state === 'completed' ? 'finalizing' : 'starting' : fresh ? 'interrupted' : p?.state;
  const labels = { starting: 'Starting backup', connecting: 'Connecting to your mailbox', discovering: 'Counting matching email',
    downloading: 'Backing up your email', checking: 'Checking already saved email', verifying: 'Verifying saved files', completed: 'Selected backup complete',
    failed: 'Backup needs attention', interrupted: 'Backup was interrupted', paused: 'Backup paused',
    stopping: 'Finishing the current email', stopped: 'Backup stopped', cancelled: 'Backup cancelled', retrying: 'Waiting to reconnect', finalizing: 'Finishing backup tasks' };
  const known = p?.totalMessages != null && (fresh || !active);
  const percent = known ? p.state === 'completed' ? 100 : Math.min(100, Math.floor(p.processedMessages * 100 / Math.max(1, p.totalMessages))) : null;
  return `<section class="panel run-progress" aria-labelledby="progress-title">
    <div class="panel-head"><h2 id="progress-title">${labels[phase] || 'Backup progress'}</h2><span class="run-state">${active ? 'Live' : 'Finished'}</span></div>
    <div class="progress-heading"><strong>${known ? `${formatNumber(p.processedMessages)} / ${formatNumber(p.totalMessages)} messages checked` : fresh && p.phase === 'checking' ? `Checked ${formatNumber(p.alreadyVerified)} saved emails` : active && !p ? `${formatNumber(dashboard.totalMessages)} messages saved so far` : 'Preparing your selected backup'}</strong><span>${percent == null ? '' : `${percent}%`}</span></div>
    <progress max="100" ${percent == null ? '' : `value="${percent}"`} aria-label="Backup progress"></progress>
    <p class="progress-detail">${escapeHtml(fresh && p.currentFolder || (phase === 'verifying' ? 'Checking the integrity of saved mail' : 'Completed emails remain on your computer'))}${fresh && p.currentMessageTotal ? ` · Current email ${formatBytes(p.currentMessageBytes)} / ${formatBytes(p.currentMessageTotal)}` : ''}</p>
    <dl class="run-stats"><div><dt>Saved this run</dt><dd>${formatNumber(p?.downloaded)}${p?.plannedDownloads != null ? ` / ${formatNumber(p.plannedDownloads)}` : ''}</dd></div><div><dt>Transferred</dt><dd>${formatBytes(p?.transferredBytes)}</dd></div><div><dt>Elapsed</dt><dd>${duration(p?.elapsedSeconds)}</dd></div><div><dt>Estimated remaining</dt><dd>${active && fresh ? duration(p.etaSeconds) : '—'}</dd></div></dl>
    ${active && fresh ? `<p class="muted">${formatNumber(p.completedFolders)} of ${formatNumber(p.totalFolders)} folders finished · ${formatBytes(p.bytesPerSecond)}/s · Updates automatically</p>` : ''}
    ${active && !p ? '<p class="muted">This run uses an older backup engine. Its log and saved-message count still update; detailed progress starts with the next run after updating.</p>' : ''}
    ${!active && fresh ? '<p class="notice">This process is no longer running. Start again to reuse completed emails.</p>' : ''}
    ${p?.remainingMessages ? `<p class="notice">${formatNumber(p.remainingMessages)} additional matching emails are outside this run's message limit. Run again to continue.</p>` : ''}
  </section>`;
}

export function backupControls(dashboard, busy, controlBusy, busyAction, escapeHtml) {
  const p = dashboard.progress;
  const active = dashboard.backupRunning && p?.runId && !['completed', 'failed', 'stopped', 'cancelled'].includes(p.state);
  const pending = active && dashboard.controlRequest?.runId === p.runId ? dashboard.controlRequest.command : null;
  const paused = active && p.state === 'paused';
  const stopping = pending === 'stop' || pending === 'cancel' || p?.state === 'stopping';
  const waiting = !paused && pending === 'pause' || paused && pending === 'resume';
  const disabled = busy || controlBusy || !active;
  const runId = active ? escapeHtml(p.runId) : '';
  return `<div class="backup-controls" role="group" aria-label="Backup controls">
    <button class="primary" data-action="backup" ${busy || controlBusy || dashboard.backupRunning || !dashboard.credentialReady ? 'disabled' : ''}>${busyAction === 'backup' ? 'Starting...' : 'Start backup'}</button>
    <button data-action="${paused ? 'resume' : 'pause'}" data-run-id="${runId}" aria-label="${paused ? 'Resume backup' : 'Pause backup'}" ${disabled || stopping || waiting ? 'disabled' : ''}>${waiting ? paused ? 'Resuming...' : 'Pausing...' : paused ? 'Resume' : 'Pause'}</button>
    <button data-action="stop" data-run-id="${runId}" aria-label="Stop backup" title="Finish the current email, then stop" ${disabled || stopping ? 'disabled' : ''}>${stopping ? 'Stopping...' : 'Stop'}</button>
    <button class="cancel-backup" data-action="cancel" data-run-id="${runId}" aria-label="Cancel backup" title="Cancel now; completed emails are kept" ${disabled || pending === 'cancel' ? 'disabled' : ''}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15"/></svg></button>
  </div>`;
}

export function statusDownloadProgress(dashboard, number, exports = 0) {
  if (exports) return `<div class="status-download"><span>Saving download${exports > 1 ? 's' : ''}...</span><progress max="100" aria-label="Saving downloads"></progress></div>`;
  if (!dashboard.backupRunning) return '';
  const p = dashboard.progress;
  const fresh = p && !['completed', 'failed', 'stopped', 'cancelled'].includes(p.state);
  const labels = { paused: 'Download paused', retrying: 'Reconnecting', stopping: 'Stopping download',
    connecting: 'Connecting', discovering: 'Counting emails', checking: 'Checking saved email', verifying: 'Verifying downloads' };
  const phase = fresh ? ['paused', 'retrying', 'stopping'].includes(p.state) ? p.state : p.phase : p ? 'finalizing' : 'starting';
  const known = fresh && Number.isFinite(p.plannedDownloads) && p.plannedDownloads > 0;
  const downloaded = Math.max(0, Math.min(p?.downloaded || 0, p?.plannedDownloads || 0));
  const percent = known ? Math.min(100, Math.floor(downloaded * 100 / p.plannedDownloads)) : null;
  const label = labels[phase] || (phase === 'finalizing' ? 'Finishing backup' : phase === 'downloading' ? 'Downloading' : 'Preparing download');
  return `<div class="status-download"><span>${label}${known ? `: ${number(downloaded)} / ${number(p.plannedDownloads)} (${percent}%)` : '...'}</span><progress max="100" ${known ? `value="${percent}"` : ''} aria-label="Download progress"></progress></div>`;
}
