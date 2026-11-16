const paths = {
  info: 'M10 9v5m0-8v.1M3 3h14v14H3z',
  download: 'M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4',
  success: 'm5 10 3 3 7-7M3 3h14v14H3z',
  warning: 'm10 2 8 15H2zM10 7v4m0 3v.1',
  error: 'm7 7 6 6m0-6-6 6M3 3h14v14H3z',
  folder: 'M2 5h6l2 2h8v9H2z',
};
const labels = { info: 'Update', download: 'Download', success: 'Complete', warning: 'Warning', error: 'Error', folder: 'Folder' };
const icon = type => `<svg aria-hidden="true" viewBox="0 0 20 20"><path d="${paths[type]}"/></svg>`;

export function activityEntries(tail = '') {
  return tail.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const stamp = line.match(/^\[?(\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)\]?\s*/);
    const message = stamp ? line.slice(stamp[0].length) : line;
    const type = /\b(failed|error|exception|could not|cannot)\b/i.test(message) ? 'error'
      : /\b(retry|retrying|reconnect|resuming in|warning|skipped|stopped|cancelled|temporary connection)\b/i.test(message) ? 'warning'
      : /\b(complete|completed|verified|mailbox checked)\b/i.test(message) ? 'success'
      : /\b(download|downloaded|downloading)\b/i.test(message) ? 'download'
      : /\bfolder\b/i.test(message) ? 'folder' : 'info';
    return { message, timestamp: stamp?.[1] || '', type };
  }).reverse();
}

export function activityPane(dashboard, filter, rawOpen, escape, number) {
  const entries = activityEntries(dashboard.latestLog?.tail);
  const visible = entries.filter(entry => filter !== 'problems' || ['warning', 'error'].includes(entry.type));
  const problems = entries.filter(entry => ['warning', 'error'].includes(entry.type)).length;
  const state = dashboard.backupRunning ? 'Updates automatically while your backup runs' : 'Latest log, independent of the selected backup run';
  return `<section class="activity-pane" aria-label="Activity log">
    <div class="activity-header"><div><h2>Activity log</h2><p>${state}</p></div><button data-action="open-logs">Open log folder</button></div>
    <div class="activity-toolbar"><div class="activity-source"><span class="activity-indicator ${dashboard.backupRunning ? 'is-live' : ''}"></span><span>${dashboard.backupRunning ? 'Backup running' : 'Recent activity'}</span><small>${number(entries.length)} entries${problems ? `, ${number(problems)} to review` : ''}</small></div><div class="activity-filter"><label for="activity-filter">Show</label><select id="activity-filter"><option value="all" ${filter === 'all' ? 'selected' : ''}>All activity</option><option value="problems" ${filter === 'problems' ? 'selected' : ''}>Warnings and errors</option></select></div></div>
    ${visible.length ? `<div class="activity-feed-heading"><span>Newest first</span><span>Latest log excerpt</span></div><ol class="activity-feed">${visible.map(entry => `<li class="activity-entry activity-${entry.type}"><span class="activity-event-icon">${icon(entry.type)}</span><div class="activity-event-body"><div class="activity-event-meta"><strong>${labels[entry.type]}</strong>${entry.timestamp ? `<time>${escape(entry.timestamp)}</time>` : ''}</div><p>${escape(entry.message)}</p></div></li>`).join('')}</ol>` : `<div class="activity-empty">${icon(filter === 'problems' && entries.length ? 'success' : 'info')}<h3>${filter === 'problems' && entries.length ? 'Nothing to review' : 'Your activity starts here'}</h3><p>${filter === 'problems' && entries.length ? 'No warnings or errors in the latest log excerpt.' : 'Run a backup or check your mailbox to see updates here.'}</p></div>`}
    ${entries.length ? `<details class="activity-raw" ${rawOpen ? 'open' : ''}><summary>View raw log</summary><p>${escape(dashboard.latestLog?.name || 'Latest log')}</p><pre>${escape(dashboard.latestLog.tail)}</pre></details>` : ''}
  </section>`;
}
