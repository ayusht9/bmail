const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { sortMail } = require('./mail-page.cjs');
const columns = new Set(['subject', 'sender', 'folder', 'sentAt', 'bytes']);

// A disposable, account-local index. The manifest and .eml files remain authoritative.
function queryPage(root, revision, rows, options = {}) {
  const directory = path.join(root, '.cache');
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'mail-metadata.db'));
  try {
    db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS revision (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, folder TEXT, search TEXT, payload TEXT);
      CREATE INDEX IF NOT EXISTS messages_folder ON messages(folder);
      CREATE TABLE IF NOT EXISTS ordering (sort TEXT, id TEXT, rank INTEGER, PRIMARY KEY(sort, id));
      CREATE INDEX IF NOT EXISTS ordering_rank ON ordering(sort, rank);`);
    if (db.prepare('SELECT value FROM revision WHERE id=1').get()?.value !== revision) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('DELETE FROM messages; DELETE FROM ordering;');
        const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?)');
        for (const row of rows) insert.run(row.id, row.folder || '', [row.subject, row.sender, row.folder].join(' ').toLocaleLowerCase(), JSON.stringify(row));
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
    const clauses = [];
    const args = [];
    if (options.folder) { clauses.push('m.folder=?'); args.push(options.folder); }
    for (const term of String(options.query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)) {
      clauses.push('instr(m.search, ?) > 0'); args.push(term);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = db.prepare(`SELECT count(*) AS total FROM messages m ${where}`).get(...args).total;
    const pageSize = [25, 50, 100].includes(Number(options.pageSize)) ? Number(options.pageSize) : 50;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Number.isFinite(Number(options.page)) ? Math.max(1, Math.min(pages, Math.floor(Number(options.page)))) : 1;
    const result = db.prepare(`SELECT m.payload FROM ordering o JOIN messages m ON m.id=o.id
      ${where ? where + ' AND' : 'WHERE'} o.sort=? ORDER BY o.rank LIMIT ? OFFSET ?`)
      .all(...args, sort, pageSize, (page - 1) * pageSize).map(row => JSON.parse(row.payload));
    return { rows: result, total, page, pageSize, pages };
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
