export function mailSearchFilters(folders, escape, now = new Date()) {
  const today = now.toLocaleDateString('en-GB');
  const dateInput = name => `<span class="mail-date-field"><input name="${name}" aria-label="${name === 'dateFrom' ? 'Sent from' : 'Sent through'}" type="date" data-empty="true" placeholder="${escape(today)}"><span aria-hidden="true">${escape(today)}</span></span>`;
  return `<details class="mail-search-filters"><summary>Mail filters <span data-filter-count></span></summary>
    <fieldset><legend class="sr-only">Filter mail results</legend>
      <label>Sender<input name="sender" type="search" list="mail-sender-options" placeholder="Choose or type a sender" autocomplete="off"><datalist id="mail-sender-options"></datalist></label>
      <label>Folder<select name="mailFolder" aria-label="Folder"><option value="">All folders</option>${[...new Set(folders)].map(folder => `<option value="${escape(folder)}">${escape(folder)}</option>`).join('')}</select></label>
      <label>Sent from${dateInput('dateFrom')}</label>
      <label>Sent through${dateInput('dateTo')}</label>
      <label>Backup status<select name="backupStatus" aria-label="Backup status"><option value="">All mail</option><option value="saved">Backed up</option><option value="missing">Not backed up</option></select></label>
      <button type="button" data-clear-mail-filters>Clear filters</button>
    </fieldset><p>Dates include the whole day in your local time. Filters apply to mail results.</p>
  </details>`;
}

export function readMailSearchFilters(dialog) {
  const value = name => dialog.querySelector(`[name="${name}"]`).value;
  const filters = { sender: value('sender').trim(), dateFrom: value('dateFrom'), dateTo: value('dateTo'), backupStatus: value('backupStatus') };
  const folder = value('mailFolder');
  const count = Object.values(filters).filter(Boolean).length + Number(Boolean(folder));
  const error = filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo
    ? 'The start date must be on or before the end date.' : '';
  return { folder: folder || null, filters, count, error };
}
