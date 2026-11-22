const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { sortMail, normalizeMailFilters } = require('./mail-page.cjs');
const columns = new Set(['subject', 'sender', 'folder', 'sentAt', 'bytes']);

// A disposable, account-local index. The manifest and .eml files remain authoritative.
function queryPage(root, revision, rows, options = {}) {
  const directory = path.join(root, '.cache');
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'mail-metadata.db'));
  try {
    db.exec('PRAGMA busy_timeout=5000');
    // This is a derived cache: migrate the old schema by rebuilding metadata.
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('PRAGMA user_version').get().user_version !== 2) {
        db.exec('DROP TABLE IF EXISTS revision; DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS ordering; PRAGMA user_version=2;');
      }
      db.exec(`
      CREATE TABLE IF NOT EXISTS revision (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, folder TEXT, search TEXT, payload TEXT, sender TEXT, sent_at INTEGER, backed_up INTEGER);
      CREATE INDEX IF NOT EXISTS messages_folder ON messages(folder);
      CREATE INDEX IF NOT EXISTS messages_date ON messages(sent_at);
      CREATE INDEX IF NOT EXISTS messages_backup_date ON messages(backed_up, sent_at);
      CREATE TABLE IF NOT EXISTS ordering (sort TEXT, id TEXT, rank INTEGER, PRIMARY KEY(sort, id));
      CREATE INDEX IF NOT EXISTS ordering_rank ON ordering(sort, rank);`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    if (db.prepare('SELECT value FROM revision WHERE id=1').get()?.value !== revision) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('DELETE FROM messages; DELETE FROM ordering;');
        const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const row of rows) insert.run(row.id, row.folder || '', [row.subject, row.sender, row.folder].join(' ').toLocaleLowerCase(), JSON.stringify(row), String(row.sender || '').toLocaleLowerCase(), Number.isFinite(Date.parse(row.sentAt)) ? Date.parse(row.sentAt) : null, row.backedUp ? 1 : 0);
        db.prepare('INSERT OR REPLACE INTO revision VALUES (1, ?)').run(revision);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const sortColumn = columns.has(options.sortColumn) ? options.sortColumn : 'sentAt';
    const sortDirection = options.sortDirection === 'asc' ? 'asc' : 'desc';
    const sort = `${sortColumn}:${sortDirection}`;
    if (!db.prepare('SELECT 1 FROM ordering WHERE sort=? LIMIT 1').get(sort)) {
      // Persist locale-aware, numeric text ordering so subsequent pages and searches
      // use an indexed SQL query while retaining the existing UI sort semantics.
      const sorted = sortMail(rows, { sortColumn, sortDirection });
      db.exec('BEGIN IMMEDIATE');
      try {
        const insert = db.prepare('INSERT OR REPLACE INTO ordering VALUES (?, ?, ?)');
        sorted.forEach((row, rank) => insert.run(sort, row.id, rank));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const filters = normalizeMailFilters(options.filters);
    const clauses = [];
    const args = [];
    if (options.folder) { clauses.push('m.folder=?'); args.push(options.folder); }
    for (const term of String(options.query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)) {
      clauses.push('instr(m.search, ?) > 0'); args.push(term);
    }
    if (filters.sender) { clauses.push('instr(m.sender, ?) > 0'); args.push(filters.sender); }
    if (filters.after !== null) { clauses.push('m.sent_at >= ?'); args.push(filters.after); }
    if (filters.before !== null) { clauses.push('m.sent_at < ?'); args.push(filters.before); }
    if (filters.backupStatus) { clauses.push('m.backed_up = ?'); args.push(filters.backupStatus === 'saved' ? 1 : 0); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = db.prepare(`SELECT count(*) AS total FROM messages m ${where}`).get(...args).total;
    const pageSize = [25, 50, 100].includes(Number(options.pageSize)) ? Number(options.pageSize) : 50;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Number.isFinite(Number(options.page)) ? Math.max(1, Math.min(pages, Math.floor(Number(options.page)))) : 1;
    const result = db.prepare(`SELECT m.payload FROM ordering o JOIN messages m ON m.id=o.id
      ${where ? where + ' AND' : 'WHERE'} o.sort=? ORDER BY o.rank LIMIT ? OFFSET ?`)
      .all(...args, sort, pageSize, (page - 1) * pageSize).map(row => JSON.parse(row.payload));
    const response = { rows: result, total, page, pageSize, pages };
    if (options.includeSenders) response.senders = db.prepare(`SELECT DISTINCT json_extract(payload, '$.sender') AS sender
      FROM messages WHERE trim(sender) <> '' ORDER BY sender COLLATE NOCASE`).all().map(row => row.sender);
    return response;
  } finally { db.close(); }
}

function metadataPage(root, revision, rows, options = {}) {
  try { return queryPage(root, revision, rows, options); }
  catch (error) {
    // Only a corrupt/non-database cache is discarded. Busy and permission errors
    // fall back to the reader without touching a potentially active database.
    if (![11, 26].includes(error.errcode)) throw error;
    fs.unlinkSync(path.join(root, '.cache', 'mail-metadata.db'));
    return queryPage(root, revision, rows, options);
  }
}
module.exports = { metadataPage };
