const columns = new Set(['subject', 'sender', 'folder', 'sentAt', 'bytes']);
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function dateBoundary(value, nextDay = false) {
  if (!value) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a valid mail date.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('Choose a valid mail date.');
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.getTime();
}

function normalizeMailFilters(filters = {}) {
  filters = filters && typeof filters === 'object' ? filters : {};
  const after = dateBoundary(filters.dateFrom);
  const before = dateBoundary(filters.dateTo, true);
  if (after !== null && before !== null && after >= before) throw new Error('The start date must be on or before the end date.');
  return { sender: String(filters.sender || '').trim().toLocaleLowerCase(), after, before,
    backupStatus: ['saved', 'missing'].includes(filters.backupStatus) ? filters.backupStatus : '' };
}

function filterMail(rows, options = {}) {
  const filters = normalizeMailFilters(options.filters);
  return rows.filter(row => {
    if (options.folder && row.folder !== options.folder) return false;
    if (filters.sender && !String(row.sender || '').toLocaleLowerCase().includes(filters.sender)) return false;
    if (filters.backupStatus && Boolean(row.backedUp) !== (filters.backupStatus === 'saved')) return false;
    if (filters.after !== null || filters.before !== null) {
      const sentAt = Date.parse(row.sentAt);
      if (!Number.isFinite(sentAt) || filters.after !== null && sentAt < filters.after || filters.before !== null && sentAt >= filters.before) return false;
    }
    return true;
  });
}

function sortMail(rows, { sortColumn = 'sentAt', sortDirection = 'desc' } = {}) {
  const column = columns.has(sortColumn) ? sortColumn : 'sentAt';
  const direction = sortDirection === 'asc' ? 1 : -1;
  const numeric = column === 'sentAt' || column === 'bytes';
  const value = message => column === 'sentAt' ? Date.parse(message.sentAt) || 0 : column === 'bytes' ? Number(message.bytes) || 0
    : String(message[column] || (column === 'subject' ? 'No subject' : column === 'sender' ? 'Unknown sender' : ''));
  // Compute each sort key once instead of on every comparison.
  const keyed = rows.map(row => [value(row), row]);
  keyed.sort((a, b) => direction * (numeric ? a[0] - b[0] : collator.compare(a[0], b[0])));
  return keyed.map(entry => entry[1]);
}

function paginateMail(rows, options = {}, presorted = false) {
  rows = filterMail(rows, options);
  const terms = String(options.query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length) rows = rows.filter(row => {
    const text = [row.subject, row.sender, row.folder].join(' ').toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
  let { page = 1, pageSize = 50 } = options;
  pageSize = [25, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 50;
  const sorted = presorted ? rows : sortMail(rows, options);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  page = Number.isFinite(Number(page)) ? Math.max(1, Math.min(pages, Math.floor(Number(page)))) : 1;
  return { rows: sorted.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, pages };
}

module.exports = { paginateMail, sortMail, normalizeMailFilters };
