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
  const phase = active ? fresh ? p.phase : 'starting' : fresh ? 'interrupted' : p?.state;
  const labels = { starting: 'Starting backup', connecting: 'Connecting to your mailbox', discovering: 'Counting matching email',
    downloading: 'Backing up your email', checking: 'Checking already saved email', verifying: 'Verifying saved files', completed: 'Selected backup complete',
    failed: 'Backup needs attention', interrupted: 'Backup was interrupted', paused: 'Backup paused',
    stopping: 'Finishing the current email', stopped: 'Backup stopped', cancelled: 'Backup cancelled', retrying: 'Waiting to reconnect' };
  const known = p?.totalMessages != null && (fresh || !active);
  const percent = known ? p.state === 'completed' ? 100 : Math.min(100, Math.floor(p.processedMessages * 100 / Math.max(1, p.totalMessages))) : null;
  return `<section class="panel run-progress" aria-labelledby="progress-title">
    <div class="panel-head"><h2 id="progress-title">${labels[phase] || 'Backup progress'}</h2><span class="run-state">${active ? 'Live' : 'Finished'}</span></div>
    <div class="progress-heading"><strong>${known ? `${formatNumber(p.processedMessages)} / ${formatNumber(p.totalMessages)} messages checked` : active && !p ? `${formatNumber(dashboard.totalMessages)} messages saved so far` : 'Preparing your selected backup'}</strong><span>${percent == null ? '' : `${percent}%`}</span></div>
    <progress max="100" ${percent == null ? '' : `value="${percent}"`} aria-label="Backup progress"></progress>
    <p class="progress-detail">${escapeHtml(fresh && p.currentFolder || (phase === 'verifying' ? 'Checking the integrity of saved mail' : 'Completed emails remain on your computer'))}${fresh && p.currentMessageTotal ? ` · Current email ${formatBytes(p.currentMessageBytes)} / ${formatBytes(p.currentMessageTotal)}` : ''}</p>
    <dl class="run-stats"><div><dt>Saved this run</dt><dd>${formatNumber(p?.downloaded)}</dd></div><div><dt>Transferred</dt><dd>${formatBytes(p?.transferredBytes)}</dd></div><div><dt>Elapsed</dt><dd>${duration(p?.elapsedSeconds)}</dd></div><div><dt>Estimated remaining</dt><dd>${active && fresh ? duration(p.etaSeconds) : '—'}</dd></div></dl>
    ${active && fresh ? `<p class="muted">${formatNumber(p.completedFolders)} of ${formatNumber(p.totalFolders)} folders finished · ${formatBytes(p.bytesPerSecond)}/s · Updates automatically</p>` : ''}
    ${active && !p ? '<p class="muted">This run uses an older backup engine. Its log and saved-message count still update; detailed progress starts with the next run after updating.</p>' : ''}
    ${!active && fresh ? '<p class="notice">This process is no longer running. Start again to reuse completed emails.</p>' : ''}
    ${p?.remainingMessages ? `<p class="notice">${formatNumber(p.remainingMessages)} additional matching emails are outside this run's message limit. Run again to continue.</p>` : ''}
  </section>`;
}
