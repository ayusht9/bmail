function normalizeSelection(input = {}) {
  const folders = input.folders ?? [];
  if (!Array.isArray(folders) || folders.some(f => typeof f !== 'string' || !f.trim() || f.length > 1024)) throw new Error('Choose valid mailbox folders.');
  const date = value => {
    if (!value) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Choose a valid backup date.');
    return value;
  };
  const dateFrom = date(input.dateFrom);
  const dateTo = date(input.dateTo);
  if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('The start date must be before the end date.');
  const maxMessages = input.maxMessages ?? null;
  if (maxMessages != null && (!Number.isSafeInteger(maxMessages) || maxMessages < 1 || maxMessages > 1000000)) throw new Error('Choose a message limit from 1 to 1,000,000, or leave it unlimited.');
  return { folders: [...new Set(folders)], dateFrom, dateTo, maxMessages };
}
function searchForSelection(selection) {
  const query = { all: true };
  if (selection.dateFrom) query.since = new Date(selection.dateFrom + 'T00:00:00Z');
  if (selection.dateTo) query.before = new Date(Date.parse(selection.dateTo + 'T00:00:00Z') + 86400000);
  return query;
}
module.exports = { normalizeSelection, searchForSelection };
