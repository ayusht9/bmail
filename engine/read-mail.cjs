const fs = require('node:fs');
const path = require('node:path');
const { simpleParser } = require('mailparser');
const { dataDirectory } = require('./paths.cjs');

async function readSavedMail(root, file) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
  const allowed = Object.values(manifest.folders || {}).some(folder => Object.values(folder.messages || {}).some(record => record.complete !== false && record.file === file));
  if (!allowed) throw new Error('This email is not in the saved mailbox.');
  const base = fs.realpathSync(root);
  const source = fs.realpathSync(path.resolve(base, file));
  const relative = path.relative(base, source);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative) || path.extname(source).toLowerCase() !== '.eml') throw new Error('Invalid saved email path.');
  if (fs.statSync(source).size > 50 * 1024 * 1024) throw new Error('This email is too large for the reading pane. Download it to open it.');
  const mail = await simpleParser(fs.createReadStream(source), { skipHtmlToText: true, skipTextToHtml: true });
  return { subject: mail.subject || 'No subject', from: mail.from?.text || 'Unknown sender', to: mail.to?.text || '', cc: mail.cc?.text || '',
    date: mail.date && Number.isFinite(mail.date.getTime()) ? mail.date.toISOString() : null,
    text: mail.text || '', html: mail.html || '', attachments: mail.attachments.map(item => ({ name: item.filename || 'Attachment', size: item.size })) };
}

async function listSavedMail(root, selected) {
  const filename = path.join(root, 'manifest.json');
  if (!fs.existsSync(filename)) return [];
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  const base = fs.realpathSync(root);
  const cachePath = path.join(base, '.cache', 'mail-headers.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}
  const rows = [];
  let changed = false;
  for (const folder of Object.values(manifest.folders || {})) {
    if (selected && folder.name !== selected) continue;
    for (const record of Object.values(folder.messages || {})) {
      if (record.complete === false) continue;
      let sentAt = record.sentAt || null;
      let backedUp = false;
      let bytes = record.bytes || 0;
      try {
        const source = fs.realpathSync(path.resolve(base, record.file));
        const relative = path.relative(base, source);
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Invalid saved path');
        const stat = fs.statSync(source);
        backedUp = stat.isFile() && (record.bytes == null || stat.size === record.bytes);
        bytes = stat.size;
        if (!sentAt) {
          const stamp = `${stat.size}:${stat.mtimeMs}`;
          if (cache[record.file]?.stamp === stamp) sentAt = cache[record.file].sentAt;
          else {
            const fd = fs.openSync(source, 'r');
            const buffer = Buffer.alloc(Math.min(stat.size, 256 * 1024));
            let read;
            try { read = fs.readSync(fd, buffer, 0, buffer.length, 0); } finally { fs.closeSync(fd); }
            const data = buffer.subarray(0, read);
            let end = data.indexOf('\r\n\r\n');
            if (end < 0) end = data.indexOf('\n\n');
            const parsed = await simpleParser(Buffer.concat([end >= 0 ? data.subarray(0, end) : data, Buffer.from('\r\n\r\n')]), { skipHtmlToText: true, skipTextToHtml: true });
            sentAt = parsed.date && Number.isFinite(parsed.date.getTime()) ? parsed.date.toISOString() : null;
            cache[record.file] = { stamp, sentAt }; changed = true;
          }
        }
      } catch { /* Missing or damaged saved files remain visible without a backup indicator. */ }
      rows.push({ folder: folder.name, file: record.file, subject: record.subject, sender: record.sender, sentAt, bytes, backedUp });
    }
  }
  if (changed) try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const temporary = cachePath + `.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(cache)); fs.renameSync(temporary, cachePath);
  } catch { /* The derived cache is optional. */ }
  return rows;
}

if (require.main === module) (async () => {
  const data = dataDirectory();
  const config = JSON.parse(fs.readFileSync(path.join(data, 'backup-config.json'), 'utf8').replace(/^\uFEFF/, ''));
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  const { file, folder } = JSON.parse(input);
  const root = path.resolve(data, config.backupDirectory || 'backups');
  console.log(JSON.stringify(process.argv.includes('--list') ? await listSavedMail(root, folder) : await readSavedMail(root, file)));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { readSavedMail, listSavedMail };
