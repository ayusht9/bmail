const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { dataDirectory } = require('./paths.cjs');
const { readMailIndex } = require('./mail-index.cjs');
const { paginateMail } = require('./mail-page.cjs');
const { createHash } = require('node:crypto');

// mailparser is comparatively slow to load. Listing pages only needs it for
// legacy manifest records without sentAt, so load it on first use.
let parser;
const simpleParser = (...args) => (parser ||= require('mailparser').simpleParser)(...args);

// Saved files are written only by backups, which also replace the manifest.
// Re-check files at least this often to notice manual deletion or damage.
const FILE_CHECK_MS = 2 * 60 * 1000;
const MAX_CACHED_ROOTS = 4;
const roots = new Map();

function stampOf(filename) {
  const stat = fs.statSync(filename, { throwIfNoEntry: false });
  return stat ? `${stat.size}:${stat.mtimeMs}` : '';
}

function readJsonFile(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
}

function rootState(root) {
  let state = roots.get(root);
  if (!state) {
    state = { manifestStamp: null, manifest: null, files: null, checks: new Map(), list: null, sorted: new Map() };
    if (roots.size >= MAX_CACHED_ROOTS) roots.delete(roots.keys().next().value);
    roots.set(root, state);
  }
  return state;
}

function loadManifest(root) {
  const state = rootState(root);
  const filename = path.join(root, 'manifest.json');
  const stamp = stampOf(filename);
  if (!stamp) { state.manifestStamp = ''; state.manifest = null; state.files = null; return state; }
  if (state.manifestStamp !== stamp) {
    state.manifest = readJsonFile(filename);
    state.manifestStamp = stamp;
    state.files = null;
  }
  return state;
}

function inside(base, target) {
  const relative = path.relative(base, target);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function readSavedMail(root, file) {
  const state = loadManifest(root);
  if (!state.files) {
    state.files = new Set();
    for (const folder of Object.values(state.manifest?.folders || {})) {
      for (const record of Object.values(folder.messages || {})) if (record.complete !== false && record.file) state.files.add(record.file);
    }
  }
  if (!state.files.has(file)) throw new Error('This email is not in the saved mailbox.');
  const base = fs.realpathSync(root);
  const source = fs.realpathSync(path.resolve(base, file));
  if (!inside(base, source) || path.extname(source).toLowerCase() !== '.eml') throw new Error('Invalid saved email path.');
  if (fs.statSync(source).size > 50 * 1024 * 1024) throw new Error('This email is too large for the reading pane. Download it to open it.');
  const mail = await simpleParser(fs.createReadStream(source), { skipHtmlToText: true, skipTextToHtml: true });
  return { subject: mail.subject || 'No subject', from: mail.from?.text || 'Unknown sender', to: mail.to?.text || '', cc: mail.cc?.text || '',
    date: mail.date && Number.isFinite(mail.date.getTime()) ? mail.date.toISOString() : null,
    text: mail.text || '', html: mail.html || '', attachments: mail.attachments.map(item => ({ name: item.filename || 'Attachment', size: item.size })) };
}

// A single lstat per message. Lexical containment plus rejecting symbolic links
// keeps listing inside the backup folder without a per-file realpath, which on
// Windows walks every path component. Opening a message still uses realpath.
function checkFile(state, base, record, now, reuse) {
  const cached = reuse && state.checks.get(record.file);
  if (cached && cached.expected === record.bytes && now - cached.at < FILE_CHECK_MS) return cached;
  const result = { expected: record.bytes, at: now, backedUp: false, bytes: record.bytes || 0, stat: null };
  const source = path.resolve(base, record.file);
  if (inside(base, source)) {
    try {
      const stat = fs.lstatSync(source, { throwIfNoEntry: false });
      if (stat?.isFile()) {
        result.backedUp = record.bytes == null || stat.size === record.bytes;
        result.bytes = stat.size;
        result.stat = `${stat.size}:${stat.mtimeMs}`;
      }
    } catch { /* Missing or damaged saved files remain visible without a backup indicator. */ }
  }
  state.checks.set(record.file, result);
  return result;
}

async function headerDate(source, size) {
  const fd = fs.openSync(source, 'r');
  const buffer = Buffer.alloc(Math.min(size, 256 * 1024));
  let read;
  try { read = fs.readSync(fd, buffer, 0, buffer.length, 0); } finally { fs.closeSync(fd); }
  const data = buffer.subarray(0, read);
  let end = data.indexOf('\r\n\r\n');
  if (end < 0) end = data.indexOf('\n\n');
  const parsed = await simpleParser(Buffer.concat([end >= 0 ? data.subarray(0, end) : data, Buffer.from('\r\n\r\n')]), { skipHtmlToText: true, skipTextToHtml: true });
  return parsed.date && Number.isFinite(parsed.date.getTime()) ? parsed.date.toISOString() : null;
}

async function listSavedMail(root, selected, reuse = false) {
  const state = loadManifest(root);
  if (!state.manifest) return [];
  const base = fs.realpathSync(root);
  const cachePath = path.join(base, '.cache', 'mail-headers.json');
  let cache = null;
  let changed = false;
  const now = Date.now();
  const rows = [];
  for (const [folderKey, folder] of Object.entries(state.manifest.folders || {})) {
    if (selected && folder.name !== selected) continue;
    for (const [uid, record] of Object.entries(folder.messages || {})) {
      if (record.complete === false) continue;
      const check = checkFile(state, base, record, now, reuse);
      let sentAt = record.sentAt || null;
      if (!sentAt && check.stat) {
        if (!cache) { try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { cache = {}; } }
        if (cache[record.file]?.stamp === check.stat) sentAt = cache[record.file].sentAt;
        else {
          try { sentAt = await headerDate(path.resolve(base, record.file), check.bytes); } catch { sentAt = null; }
          cache[record.file] = { stamp: check.stat, sentAt }; changed = true;
        }
      }
      rows.push({ id: `${folderKey}:${uid}`, uid: Number(uid), folder: folder.name, file: record.file, subject: record.subject, sender: record.sender, sentAt, bytes: check.bytes, backedUp: check.backedUp });
    }
  }
  if (changed) try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const temporary = cachePath + `.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(cache)); fs.renameSync(temporary, cachePath);
  } catch { /* The derived cache is optional. */ }
  return rows;
}

function readIndex(root) {
  return readMailIndex(root, (filename, fallback) => {
    try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { return fallback; }
  });
}

function mergeMailbox(saved, folders, selected) {
  const checked = Object.keys(folders).length > 0;
  const rows = new Map(saved.map(row => [row.id, { ...row, onServer: checked ? false : null, isNew: false }]));
  for (const [key, folder] of Object.entries(folders)) {
    if (selected && folder.name !== selected) continue;
    const newUids = new Set(folder.newUids || []);
    for (const [uid, message] of Object.entries(folder.messages || {})) {
      const id = `${key}:${uid}`;
      const local = rows.get(id);
      rows.set(id, { ...message, ...local, id, folder: folder.name, uid: Number(uid), file: local?.file || '',
        backedUp: local?.backedUp || false, onServer: true, isNew: newUids.has(Number(uid)) });
    }
  }
  return [...rows.values()];
}

async function listMailbox(root, selected) {
  return mergeMailbox(await listSavedMail(root, selected), readIndex(root), selected);
}

// The complete merged list is reused while the manifest and server index are
// unchanged, so paging and sorting do not rescan the backup folder.
async function cachedMailbox(root) {
  const state = loadManifest(root);
  const key = `${state.manifestStamp}|${stampOf(path.join(root, 'mail-index.json'))}`;
  if (state.list?.key === key && Date.now() - state.list.at < FILE_CHECK_MS) return state;
  const rows = mergeMailbox(await listSavedMail(root, '', true), readIndex(root));
  state.list = { key, at: Date.now(), rows, revision: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  state.sorted.clear();
  return state;
}

async function listMailPage(root, options = {}) {
  const state = await cachedMailbox(root);
  try {
    return require('./mail-metadata.cjs').metadataPage(root, state.list.revision, state.list.rows, options);
  } catch {
    // Read-only storage, an older runtime, or a damaged derived DB must not hide mail.
    const result = paginateMail(options.folder ? state.list.rows.filter(row => row.folder === options.folder) : state.list.rows, options);
    if (options.includeSenders) result.senders = [...new Set(state.list.rows.map(row => row.sender).filter(sender => typeof sender === 'string' && sender.trim()))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return result;
  }
}

function backupRoot(data) {
  const config = readJsonFile(path.join(data, 'backup-config.json'));
  return path.resolve(data, config.backupDirectory || 'backups');
}

async function handle(request, data = dataDirectory()) {
  const root = backupRoot(data);
  if (request.kind === 'message') return readSavedMail(root, request.file);
  if (request.kind === 'page') return listMailPage(root, request);
  return listMailbox(root, request.folder);
}

// Long-lived mode: one JSON request per stdin line, one JSON response per
// stdout line. Exits when idle or when the desktop app closes its stdin.
function serve(idleMs = 5 * 60 * 1000) {
  let idle;
  const touch = () => { clearTimeout(idle); idle = setTimeout(() => process.exit(0), idleMs); };
  touch();
  let queue = Promise.resolve();
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', line => {
    queue = queue.then(async () => {
      touch();
      let id = null;
      let response;
      try {
        const message = JSON.parse(line);
        id = message.id ?? null;
        response = { id, ok: true, result: await handle(message.request, message.data) };
      } catch (error) {
        response = { id, ok: false, error: error?.message || 'Could not read saved mail.' };
      }
      process.stdout.write(JSON.stringify(response) + '\n');
      touch();
    });
  });
  input.on('close', () => queue.then(() => process.exit(0)));
}

if (require.main === module) {
  if (process.argv.includes('--serve')) serve();
  else (async () => {
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    const request = JSON.parse(input);
    const kind = process.argv.includes('--list') ? request.paginated ? 'page' : 'list' : 'message';
    console.log(JSON.stringify(await handle({ ...request, kind })));
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { readSavedMail, listSavedMail, listMailbox, listMailPage, handle };
