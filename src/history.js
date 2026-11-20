import { userMessage } from './errors.js';
import { formatBytes } from './statistics.js';
import { duration } from './progress.js';
import { paneDivider } from './panes.js';
import { tableStart, columnHandle } from './columns.js';

export function historyPane(dashboard, filter, selectedId, escape, date, number) {
  let records = Array.isArray(dashboard.history) ? dashboard.history : [];
  if (!records.length && dashboard.lastRun?.startedAt) records = [{ ...dashboard.lastRun, runId: dashboard.lastRun.runId || 'last-run', outcome: dashboard.lastRun.outcome || (dashboard.lastRun.success ? 'completed' : 'failed') }];
  const visible = records.filter(record => filter === 'all' || record.outcome === filter);
  const selected = visible.find(record => record.runId === selectedId);
  const rows = visible.map(record => `<tr class="${record === selected ? 'selected' : ''}" data-action="history-select" data-run-id="${escape(record.runId)}"><td><button data-action="history-select" data-run-id="${escape(record.runId)}">${date(record.startedAt)}</button></td><td>${escape(record.outcome)}</td><td>${number(record.downloaded)}</td><td>${record.durationSeconds == null ? 'Not recorded' : duration(record.durationSeconds)}</td></tr>`).join('');
  const scope = selected?.scope;
  const labels = { unreadOnly: 'unread', flaggedOnly: 'starred', sender: 'sender', subject: 'subject', minSizeKB: 'minimum size', maxSizeMB: 'maximum size' };
  const scopeText = scope ? `${scope.allFolders ? 'All folders' : `${scope.folderCount} selected folders`}${scope.excludedFolderCount ? `, ${scope.excludedFolderCount} excluded` : ''}; ${scope.lastDays ? `last ${scope.lastDays} days` : `${scope.dateFrom || 'beginning'} to ${scope.dateTo || 'today'}`}${scope.maxMessages ? `; up to ${scope.maxMessages} new messages` : ''}${scope.filters?.length ? `; filters: ${scope.filters.map(filter => labels[filter] || 'custom').join(', ')}` : ''}` : 'Older run; selection details not recorded';
  return `<section class="history-pane mailbox-panes" aria-label="Backup history"><div class="history-list mail-pane"><div class="pane-title"><h2>Backup history</h2><label>Result <select id="history-filter">${['all','completed','failed','stopped','cancelled'].map(value => `<option value="${value}" ${filter === value ? 'selected' : ''}>${value === 'all' ? 'All results' : value[0].toUpperCase() + value.slice(1)}</option>`).join('')}</select></label></div>
    ${dashboard.historyError || dashboard.lastRun?.historyError ? `<p class="notice error">${escape(userMessage(dashboard.historyError || dashboard.lastRun.historyError))}</p>` : ''}
    <div class="table-wrap">${tableStart('history', 'history-table')}<thead><tr>${['Started', 'Result', 'Downloaded', 'Duration'].map((label, index) => `<th>${label}${columnHandle('history', index, label)}</th>`).join('')}</tr></thead><tbody>${rows || '<tr><td colspan="4">No matching backup runs.</td></tr>'}</tbody></table></div></div>
    ${paneDivider('mail', 'Resize history table and run details')}
    ${selected ? `<section class="history-details reading-pane" aria-label="Run details"><h3>Run details</h3><dl><div><dt>Started</dt><dd>${date(selected.startedAt)}</dd></div><div><dt>Finished</dt><dd>${date(selected.finishedAt)}</dd></div><div><dt>Downloaded</dt><dd>${number(selected.downloaded)}</dd></div><div><dt>Transferred</dt><dd>${formatBytes(selected.transferredBytes)}</dd></div><div><dt>Saved this run</dt><dd>${formatBytes(selected.savedBytes)}</dd></div><div><dt>Local message total</dt><dd>${selected.totalLocalMessages == null ? 'Not recorded' : number(selected.totalLocalMessages)}</dd></div></dl><p>${escape(scopeText)}</p><p>${selected.verificationSkipped ? 'Final archive verification was skipped.' : 'New downloads were verified; see run errors for any incomplete verification.'}</p>${selected.error ? `<p class="notice error">${escape(userMessage(selected.error))}</p>` : ''}</section>` : '<section class="history-details reading-pane reading-empty" aria-label="Run details"><h3>Select a backup run</h3><p>Choose a row above to see its details.</p></section>'}
  </section>`;
}
