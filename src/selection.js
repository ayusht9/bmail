export function selectionSummary(options = {}) {
  const folders = options.folders?.length ? options.folders.length === 1 ? options.folders[0] : `${options.folders.length} folders` : 'All folders';
  const dates = options.dateFrom || options.dateTo ? `${options.dateFrom || 'Beginning'} to ${options.dateTo || 'Today'}` : 'Any date';
  return `${folders} · ${dates} · ${options.maxMessages ? `Up to ${options.maxMessages.toLocaleString('en-IN')} new emails per run` : 'No message limit'}`;
}

export function folderChoices(names, selected, disabled, escapeHtml) {
  const all = [...new Set([...names, ...selected])];
  return `<fieldset id="folder-choices" ${disabled ? 'disabled' : ''}><legend>Mailbox folders</legend>${all.length
    ? all.map(name => `<label class="folder-choice"><input type="checkbox" name="folders" value="${escapeHtml(name)}" ${selected.includes(name) ? 'checked' : ''}><span>${escapeHtml(name)}</span></label>`).join('')
    : '<p class="muted">Load your mailbox folders to choose individual folders.</p>'}</fieldset>`;
}

export function selectionDialog(dashboard, escapeHtml) {
  const options = dashboard.backupOptions || {};
  const selected = options.folders || [];
  return `<dialog id="selection-dialog" class="selection-dialog" aria-labelledby="selection-title">
    <form id="selection-form"><h2 id="selection-title">Choose what to back up</h2>
      <p>These choices apply to manual and scheduled backups. Existing saved mail is kept when you narrow the selection.</p>
      <label class="folder-choice"><input id="all-folders" name="allFolders" type="checkbox" ${selected.length ? '' : 'checked'}><span>All available folders</span></label>
      <button type="button" class="ghost" data-action="load-folders">Load / refresh mailbox folders</button>
      <div id="folder-options">${folderChoices(dashboard.mailboxes?.folders || [], selected, !selected.length, escapeHtml)}</div>
      <p class="muted">Gmail can expose the same email under several labels. Selecting overlapping folders saves separate copies.</p>
      <div class="date-fields"><div><label for="date-from">Received from</label><input id="date-from" name="dateFrom" type="date" value="${escapeHtml(options.dateFrom || '')}"></div><div><label for="date-to">Received through</label><input id="date-to" name="dateTo" type="date" value="${escapeHtml(options.dateTo || '')}"></div></div>
      <p class="muted">Both dates are inclusive, using the date your mail server received each message.</p>
      <label for="max-messages">Maximum new emails per run</label><input id="max-messages" name="maxMessages" type="number" min="1" max="1000000" placeholder="No limit" value="${options.maxMessages || ''}">
      <p class="muted">Already saved emails do not count toward this limit. Start another run to continue with the remaining matching email.</p>
      <p id="selection-error" role="alert"></p>
      <div class="dialog-actions"><button type="button" class="ghost" data-action="cancel-selection">Cancel</button><button type="submit" class="primary">Save selection</button></div>
    </form></dialog>`;
}
