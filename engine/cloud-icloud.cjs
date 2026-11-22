const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { dataDirectory, backupEnabled } = require('./paths.cjs');
const { readJson, writeJson, acquire, alive, archiveFiles } = require('./cloud-drive.cjs');
const messages = require('./icloud-messages.json');

class ICloudError extends Error {
  constructor(code) { super(messages[code] || messages.failed); this.code = messages[code] ? code : 'failed'; }
}
const stateFile = data => path.join(data, 'cloud-icloud.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const contains = (base, target) => { const rel = path.relative(base, target); return !rel || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };

function publicStatus(data) {
  const saved = readJson(stateFile(data), {}), result = {};
  for (const key of ['connected', 'automatic', 'stage', 'folderName', 'lastCopiedAt', 'completedFiles', 'totalFiles', 'copiedBytes', 'totalBytes', 'skippedFiles', 'errorCode', 'updatedAt']) {
    if (['string', 'number', 'boolean'].includes(typeof saved[key])) result[key] = saved[key];
  }
  if (saved.stage === 'copying' && !alive(saved.pid)) { result.stage = 'interrupted'; result.errorCode = 'failed'; }
  return result;
}

function accountFolder(config) {
  const name = String(config.user).replace(/[<>:"|?*\x00-\x1f/\\]/g, '_').slice(0, 96).replace(/[. ]+$/, '');
  return `${name}-${hash(JSON.stringify([config.user, config.host])).slice(0, 16)}`;
}

function validateDestination(data, config, selected) {
  if (typeof selected !== 'string' || !path.isAbsolute(selected)) throw new ICloudError('folder');
  let root;
  try {
    const stat = fs.lstatSync(selected);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ICloudError('folder');
    root = fs.realpathSync(selected);
  } catch { throw new ICloudError('folder'); }
  const account = fs.realpathSync(data);
  const local = path.resolve(account, config.backupDirectory || 'backups');
  const archive = fs.existsSync(local) ? fs.realpathSync(local) : local;
  if ([account, archive].some(source => contains(source, root) || contains(root, source))) throw new ICloudError('overlap');
  return root;
}

// Only write beneath the selected canonical root. Junctions/symlinks inside the
// destination are rejected, including existing message files and manifest files.
function safeDirectory(root, segments) {
  let current = root;
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || /[/\\]/.test(segment)) throw new ICloudError('folder');
    current = path.join(current, segment);
    try { fs.mkdirSync(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !contains(root, fs.realpathSync(current))) throw new ICloudError('folder');
  }
  return current;
}
async function digestFile(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function publishFile(directory, name, file, options, validate) {
  validate();
  const target = path.join(directory, name);
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new ICloudError('folder');
  const digest = file.sha256 || hash(file.data);
  if (stat?.size === file.size && await digestFile(target) === digest) { validate(); return true; }
  const temporary = path.join(directory, `.bmail-${crypto.randomUUID()}.pending`);
  try {
    if (file.data) await fs.promises.writeFile(temporary, file.data, { flag: 'wx' });
    else await (options.copyFile || fs.promises.copyFile)(file.source, temporary, fs.constants.COPYFILE_EXCL);
    validate();
    if (fs.statSync(temporary).size !== file.size || await digestFile(temporary) !== digest) throw new ICloudError('files');
    validate();
    const latest = fs.lstatSync(target, { throwIfNoEntry: false });
    if (latest && (!latest.isFile() || latest.isSymbolicLink())) throw new ICloudError('folder');
    fs.renameSync(temporary, target);
    return false;
  } finally {
    // If the directory was replaced, do not follow it even for cleanup.
    let safe = true; try { validate(); } catch { safe = false; }
    if (safe) try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function copyArchive(data, config, state, update, options = {}) {
  const selected = validateDestination(data, config, state.destination);
  if (selected !== state.destination) throw new ICloudError('folder');
  update({ stage: 'copying', errorCode: '', completedFiles: 0, totalFiles: 0, copiedBytes: 0, totalBytes: 0, skippedFiles: 0 });
  let files;
  try { files = await archiveFiles(path.resolve(data, config.backupDirectory || 'backups'), config); }
  catch (error) { throw new ICloudError(error.code === 'archive' ? 'archive' : 'files'); }
  const manifest = JSON.parse(files.at(-1).data);
  const mail = files.filter(file => file.relative !== 'manifest.json');
  // Content-addressed immutable mail prevents a partial copy from invalidating
  // the previous manifest. Publish the new manifest only after every file passes.
  const locations = new Map(mail.map(file => [file.relative, `messages/${file.sha256.toLowerCase()}.eml`]));
  for (const folder of Object.values(manifest.folders)) for (const record of Object.values(folder.messages)) {
    const location = locations.get(record.file.replace(/\\/g, '/'));
    if (!location) throw new ICloudError('files');
    record.file = location;
  }
  const manifestData = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const destination = safeDirectory(selected, ['Bmail', accountFolder(config)]);
  const mailDirectory = safeDirectory(selected, ['Bmail', accountFolder(config), 'messages']);
  const totalFiles = mail.length + 1;
  const totalBytes = mail.reduce((sum, file) => sum + file.size, manifestData.length);
  let completedFiles = 0, copiedBytes = 0, skippedFiles = 0;
  update({ folderName: destination, totalFiles, totalBytes });
  for (const file of [...mail, { data: manifestData, size: manifestData.length, relative: 'manifest.json' }]) {
    if (!backupEnabled(data, 'cloud')) { update({ stage: 'ready', errorCode: '' }); return; }
    // Revalidate the directory chain before each publication, including resume
    // after an awaited copy. No files are removed from the iCloud destination.
    const validate = () => { validateDestination(data, config, selected); safeDirectory(selected, ['Bmail', accountFolder(config), 'messages']); };
    const skipped = await publishFile(file.data ? destination : mailDirectory, file.data ? 'manifest.json' : `${file.sha256.toLowerCase()}.eml`, file, options, validate);
    completedFiles++; copiedBytes += file.size; if (skipped) skippedFiles++;
    update({ completedFiles, copiedBytes, skippedFiles });
  }
  update({ stage: 'copied', lastCopiedAt: new Date().toISOString(), errorCode: '' });
}

async function run(data, action, value, options = {}) {
  if (action === 'sync' && !backupEnabled(data, 'cloud')) return publicStatus(data);
  if (action === 'status') return publicStatus(data);
  if (action === 'setup' && value == null) return publicStatus(data); // Picker cancelled.
  let release;
  try { release = acquire(data, 'icloud'); } catch (error) { throw new ICloudError(error.code); }
  const state = readJson(stateFile(data), {});
  const update = patch => { Object.assign(state, patch, { pid: process.pid, updatedAt: new Date().toISOString() }); writeJson(stateFile(data), state); };
  try {
    const config = readJson(path.join(data, 'backup-config.json'));
    if (!config?.user || !config?.host) throw new ICloudError('archive');
    if (action === 'setup') {
      const destination = validateDestination(data, config, value);
      update({ destination, connected: true, automatic: false, stage: 'ready', folderName: path.join(destination, 'Bmail', accountFolder(config)), lastCopiedAt: '', errorCode: '' });
    } else if (action === 'automatic') {
      if (typeof value !== 'boolean' || value && !state.connected) throw new ICloudError('folder');
      update({ automatic: value });
    } else if (action === 'disconnect') {
      update({ connected: false, automatic: false, stage: 'disconnected', destination: '', folderName: '', errorCode: '' });
    } else if (action === 'sync') {
      if (!state.connected) throw new ICloudError('folder');
      await copyArchive(data, config, state, update, options);
    } else throw new ICloudError('failed');
    return publicStatus(data);
  } catch (error) {
    const code = error instanceof ICloudError ? error.code : error.code === 'ENOSPC' ? 'disk' : ['EACCES', 'EPERM', 'EROFS'].includes(error.code) ? 'permission' : 'failed';
    update({ stage: 'error', errorCode: code });
    return publicStatus(data);
  } finally {
    release();
    const queued = path.join(data, '.private', 'icloud-resync');
    if (action === 'sync' && fs.existsSync(queued)) {
      fs.unlinkSync(queued);
      const latest = publicStatus(data);
      if (latest.connected && latest.automatic) await run(data, 'sync', null, options);
    }
  }
}
async function syncAfterBackup(data, options = {}) {
  const state = publicStatus(data);
  if (!state.connected || !state.automatic) return;
  try { await run(data, 'sync', null, options); }
  catch (error) { if (error.code === 'busy') writeJson(path.join(data, '.private', 'icloud-resync'), { queued: true }); }
}
if (require.main === module) (async () => {
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input || '{}');
  if (!['status', 'setup', 'automatic', 'sync', 'disconnect'].includes(request.action)) throw new ICloudError('failed');
  process.stdout.write(JSON.stringify(await run(dataDirectory(), request.action, request.value)));
})().catch(error => {
  const code = error instanceof ICloudError ? error.code : 'failed';
  process.stdout.write(JSON.stringify({ ...publicStatus(dataDirectory()), errorCode: code })); process.exitCode = 1;
});
module.exports = { run, publicStatus, copyArchive, syncAfterBackup, accountFolder, ICloudError };
