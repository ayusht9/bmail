const fs = require('node:fs');
const path = require('node:path');
const { simpleParser } = require('mailparser');

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

if (require.main === module) (async () => {
  const data = process.env.MAIL_VAULT_DATA_DIR || __dirname;
  const config = JSON.parse(fs.readFileSync(path.join(data, 'backup-config.json'), 'utf8').replace(/^\uFEFF/, ''));
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  const { file } = JSON.parse(input);
  console.log(JSON.stringify(await readSavedMail(path.resolve(data, config.backupDirectory || 'backups'), file)));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { readSavedMail };
