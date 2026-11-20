const path = require('node:path');
const { spawn } = require('node:child_process');

function recordRun(root, status, context, { readJson, atomicWrite }) {
  const file = path.join(root, 'history.json');
  const previous = readJson(file, []);
  if (!Array.isArray(previous)) throw new Error('Backup history is unreadable; existing history was kept.');
  const runId = status.runId || context.runId;
  if (!runId) return;
  const record = { runId, startedAt: status.startedAt || context.startedAt, finishedAt: status.finishedAt,
    outcome: status.outcome || (status.success ? 'completed' : 'failed'), downloaded: status.downloaded || 0,
    totalLocalMessages: status.totalLocalMessages ?? null, remainingMessages: status.remainingMessages ?? null,
    transferredBytes: context.transferredBytes || 0, savedBytes: context.savedBytes || 0,
    durationSeconds: Math.max(0, Math.round((Date.parse(status.finishedAt) - Date.parse(status.startedAt || context.startedAt)) / 1000)) || 0,
    verificationSkipped: Boolean(status.verificationSkipped), scope: status.selection ? {
      allFolders: !status.selection.folders.length, folderCount: status.selection.folders.length,
      dateFrom: status.selection.dateFrom, dateTo: status.selection.dateTo, maxMessages: status.selection.maxMessages,
      lastDays: status.selection.advanced?.lastDays || null,
      excludedFolderCount: status.selection.advanced?.excludedFolders?.length || 0,
      filters: ['unreadOnly','flaggedOnly','sender','subject','minSizeKB','maxSizeMB'].filter(key => status.selection.advanced?.[key]),
    } : null,
    error: status.error ? { message: String(status.error.message || 'Backup failed').slice(0, 2000), code: status.error.code } : null };
  atomicWrite(file, JSON.stringify([record, ...previous.filter(item => item.runId !== runId)].slice(0, 500), null, 2) + '\n');
  return record;
}

function notifyRun(config, status, options, launch = spawn) {
  const outcome = status.outcome || (status.success ? 'completed' : 'failed');
  const enabled = outcome === 'completed' ? options.notifyOnSuccess : outcome === 'failed' ? options.notifyOnFailure : options.notifyOnStopped;
  if (!enabled || process.platform !== 'win32') return Promise.resolve();
  const title = `Bmail backup ${outcome}`;
  const message = `${config.user}: ${status.downloaded || 0} messages saved. ${outcome === 'failed' ? 'Open Backup history for details.' : 'Saved mail is kept on your computer.'}`;
  return new Promise(resolve => {
    const child = launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'Notify-Backup.ps1')],
      { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'], timeout: 15000 });
    child.on('error', resolve);
    child.on('close', resolve);
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify({ title, message, failed: outcome === 'failed' }));
  });
}
module.exports = { recordRun, notifyRun };
