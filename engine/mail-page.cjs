const columns = new Set(['subject', 'sender', 'folder', 'sentAt', 'bytes']);
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

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
  let { page = 1, pageSize = 50 } = options;
  pageSize = [25, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 50;
  const sorted = presorted ? rows : sortMail(rows, options);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  page = Number.isFinite(Number(page)) ? Math.max(1, Math.min(pages, Math.floor(Number(page)))) : 1;
  return { rows: sorted.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, pages };
}

module.exports = { paginateMail, sortMail };
