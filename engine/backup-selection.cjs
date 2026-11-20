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
  const raw = input.advanced ?? {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Choose valid advanced backup options.');
  const integer = (name, fallback, min, max) => {
    const value = raw[name] ?? fallback;
    if (value !== null && (!Number.isSafeInteger(value) || value < min || value > max)) throw new Error(`Invalid backup option: ${name}`);
    return value;
  };
  const boolean = (name, fallback) => { const value = raw[name] ?? fallback; if (typeof value !== 'boolean') throw new Error(`Invalid backup option: ${name}`); return value; };
  const text = name => { const value = raw[name] ?? ''; if (typeof value !== 'string' || value.length > 500 || /[\r\n\0]/.test(value)) throw new Error(`Invalid backup filter: ${name}`); return value.trim(); };
  const excludedFolders = raw.excludedFolders ?? [];
  if (!Array.isArray(excludedFolders) || excludedFolders.length > 1000 || excludedFolders.some(f => typeof f !== 'string' || !f.trim() || f.length > 1024)) throw new Error('Choose valid excluded folders.');
  const advanced = { excludedFolders: [...new Set(excludedFolders)], lastDays: integer('lastDays', null, 1, 36500),
    unreadOnly: boolean('unreadOnly', false), flaggedOnly: boolean('flaggedOnly', false), sender: text('sender'), subject: text('subject'),
    minSizeKB: integer('minSizeKB', null, 1, 1048576), maxSizeMB: integer('maxSizeMB', null, 1, 1024),
    order: raw.order ?? 'newest', retryAttempts: integer('retryAttempts', 3, 1, 10), retryDelaySeconds: integer('retryDelaySeconds', 30, 1, 3600),
    connectionTimeoutSeconds: integer('connectionTimeoutSeconds', 30, 5, 120), socketTimeoutSeconds: integer('socketTimeoutSeconds', 300, 30, 1800),
    verifyAfterBackup: boolean('verifyAfterBackup', true), checkMailboxAfterBackup: boolean('checkMailboxAfterBackup', true),
    notifyOnSuccess: boolean('notifyOnSuccess', false), notifyOnFailure: boolean('notifyOnFailure', false), notifyOnStopped: boolean('notifyOnStopped', false) };
  if (!['newest', 'oldest'].includes(advanced.order)) throw new Error('Choose a valid download order.');
  if (advanced.lastDays && (dateFrom || dateTo)) throw new Error('Choose a rolling date range or fixed dates, not both.');
  if (advanced.minSizeKB && advanced.maxSizeMB && advanced.minSizeKB > advanced.maxSizeMB * 1024) throw new Error('Minimum message size must not exceed maximum size.');
  return { folders: [...new Set(folders)], dateFrom, dateTo, maxMessages, advanced };
}
function searchForSelection(selection, now = new Date()) {
  const query = { all: true };
  if (selection.dateFrom) query.since = new Date(selection.dateFrom + 'T00:00:00Z');
  if (selection.dateTo) query.before = new Date(Date.parse(selection.dateTo + 'T00:00:00Z') + 86400000);
  const advanced = selection.advanced || {};
  if (advanced.lastDays) {
    const date = new Date(now);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - advanced.lastDays + 1);
    query.since = date;
  }
  if (advanced.unreadOnly) query.seen = false;
  if (advanced.flaggedOnly) query.flagged = true;
  if (advanced.sender) query.from = advanced.sender;
  if (advanced.subject) query.subject = advanced.subject;
  if (advanced.minSizeKB) query.larger = advanced.minSizeKB * 1024 - 1;
  if (advanced.maxSizeMB) query.smaller = advanced.maxSizeMB * 1048576 + 1;
  return query;
}
function scheduledSelection(options = {}, schedule) {
  if (!schedule || schedule.enabled !== true) return null;
  // Old task launchers use the manual configuration. A newly saved task opts
  // into this explicit override without rewriting the account's manual choices.
  if (typeof schedule.allFolders !== 'boolean' || !Array.isArray(schedule.folders)) throw new Error('Save this account schedule again to choose its folders.');
  if (!schedule.allFolders && !schedule.folders.length) throw new Error('Choose at least one scheduled folder.');
  return normalizeSelection({ ...options, folders: schedule.allFolders ? [] : schedule.folders });
}
module.exports = { normalizeSelection, searchForSelection, scheduledSelection };
