const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const libmime = require('libmime');
const { setTimeout: sleep } = require('node:timers/promises');
const { createProgress } = require('./backup-progress.cjs');
const { normalizeSelection, searchForSelection } = require('./backup-selection.cjs');
const { RunInterrupted, readControl, createControl } = require('./backup-control.cjs');
let redactions = [];

function safeError(error) {
  const info = {};
  for (const key of ['name', 'message', 'code', 'responseStatus', 'serverResponseCode', 'responseText', 'reason', 'rejectedFrom']) {
    if (typeof error[key] !== 'string') continue;
    let value = error[key];
    for (const secret of redactions) if (secret) value = value.split(secret).join('[redacted]');
    info[key] = value;
  }
  return info;
}

function digest(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function atomicWrite(filename, data) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = filename + '.partial';
  const fd = fs.openSync(temporary, 'w');
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, filename);
}
function readJson(filename, fallback) {
  if (!fs.existsSync(filename)) return fallback;
  return JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
}
function safeName(value, limit = 80) {
  return Array.from(value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
    .replace(/\s+/g, ' ').trim()).slice(0, limit).join('').replace(/[. ]+$/, '') || 'No subject';
}
function messageLocation(folderName, key, uid, source, internalDate) {
  const end = source.indexOf('\r\n\r\n');
  const fallbackEnd = source.indexOf('\n\n');
  const headers = source.subarray(0, end >= 0 ? end : fallbackEnd >= 0 ? fallbackEnd : source.length)
    .toString('utf8').replace(/\r?\n[ \t]+/g, ' ');
  const subjectHeader = /^Subject:[ \t]*(.*)$/im.exec(headers)?.[1] || '';
  let subject;
  try { subject = libmime.decodeWords(subjectHeader).trim(); } catch { subject = subjectHeader.trim(); }
  subject ||= 'No subject';
  const fromHeader = /^From:[ \t]*([^\r\n]*)/im.exec(headers)?.[1] || '';
  let from;
  try { from = libmime.decodeWords(fromHeader).trim(); } catch { from = fromHeader.trim(); }
  // Prefer the address so senders with identical display names remain recognizable.
  const sender = (/<([^<>]+)>/.exec(from)?.[1] || from).trim() || 'Unknown sender';
  const dateHeader = /^Date:[ \t]*(.*)$/im.exec(headers)?.[1];
  let date = new Date(dateHeader || NaN);
  if (!Number.isFinite(date.getTime())) date = new Date(internalDate || NaN);
  const dateText = Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
    : 'Unknown-date';
  const month = dateText === 'Unknown-date' ? 'Unknown-month' : dateText.slice(0, 7);
  const folder = safeName(folderName, 30) + '__' + key.slice(0, 12) + '-' + key.split('-').at(-1);
  return { file: path.join('messages', folder, month,
    dateText + '_' + safeName(sender, 45) + '_' + safeName(subject, 70) + '__' + uid + '.eml'), subject, sender };
}
function organize(root, manifest) {
  let moved = 0;
  const manifestPath = path.join(root, 'manifest.json');
  for (const [key, folder] of Object.entries(manifest.folders)) {
    for (const [uid, record] of Object.entries(folder.messages)) {
      if (!validateRecord(root, record)) throw new Error('Cannot organize missing or damaged email: ' + record.file);
      const oldFile = path.resolve(root, record.file);
      const source = fs.readFileSync(oldFile);
      const location = messageLocation(folder.name, key, uid, source, record.internalDate);
      if (record.file === location.file) continue;
      const destination = path.join(root, location.file);
      if (fs.existsSync(destination)) {
        if (!fs.readFileSync(destination).equals(source)) throw new Error('Destination contains a different email');
      } else atomicWrite(destination, source);
      const updated = { ...record, ...location };
      if (!validateRecord(root, updated)) throw new Error('Organized email verification failed');
      folder.messages[uid] = updated;
      atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      // The new copy and manifest are safely committed before removing the old copy.
      fs.unlinkSync(oldFile);
      moved++;
    }
  }
  return moved;
}
function validateRecord(root, record) {
  const filename = path.resolve(root, record.file);
  if (!filename.startsWith(path.resolve(root) + path.sep)) throw new Error('Unsafe manifest path');
  try {
    const bytes = fs.readFileSync(filename);
    return bytes.length === record.bytes && digest(bytes) === record.sha256;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function acquireLock(root) {
  const filename = path.join(root, '.backup.lock');
  if (fs.existsSync(filename)) {
    const lock = readJson(filename);
    let alive = true;
    try { process.kill(lock.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) throw new Error('A backup or verification is already running');
    fs.unlinkSync(filename);
  }
  fs.writeFileSync(filename, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
  return () => fs.unlinkSync(filename);
}
function verify(root, manifest) {
  const invalid = [];
  let checked = 0;
  for (const folder of Object.values(manifest.folders)) {
    for (const record of Object.values(folder.messages)) {
      checked++;
      if (record.complete === false || !validateRecord(root, record)) invalid.push(record.file);
    }
  }
  return { checked, invalid };
}

async function fetchCompleteMessage(client, uid, progress = () => {}, seed, checkpoint = async () => {}) {
  // Bound each IMAP literal instead of requesting a large attachment in one response.
  const chunkSize = 256 * 1024;
  await checkpoint();
  const message = await client.fetchOne(uid, {
    uid: true, size: true, internalDate: true, flags: true
  }, { uid: true });
  if (!message || message.uid !== uid)
    throw new Error('A message disappeared or could not be fetched; rerun the backup');
  if (!Number.isInteger(message.size) || message.size <= 0)
    throw new Error('Downloaded message size differs from the server');
  progress(0, message.size);
  const chunks = [];
  let received = 0;
  if (seed?.length) {
    const prefix = await client.fetchOne(uid, { uid: true, source: { start: 0, maxLength: Math.min(1024, seed.length) } }, { uid: true });
    if (prefix?.uid === uid && Buffer.isBuffer(prefix.source) && prefix.source.equals(seed.subarray(0, prefix.source.length))) {
      chunks.push(seed); received = seed.length;
      progress(received, message.size);
    }
  }
  const reportedSize = message.size;
  // RFC822.SIZE is demonstrably too small for some Zoho Sent messages. Require
  // an actual zero-length response at the next offset before committing a file.
  while (true) {
    await checkpoint();
    const next = await client.fetchOne(uid, {
      uid: true, source: { start: received, maxLength: chunkSize }
    }, { uid: true });
    await checkpoint();
    if (!next || next.uid !== uid || !Buffer.isBuffer(next.source))
      throw new Error('Message download ended before its declared size');
    const origin = next.partialOrigins?.get('');
    if (origin !== received)
      throw new Error('Server did not confirm the requested message chunk offset');
    if (!next.source.length) {
      if (received < reportedSize) throw new Error('Downloaded message size differs from the server');
      break;
    }
    if (next.source.length > chunkSize || received + next.source.length > Math.max(reportedSize * 2, reportedSize + 1048576))
      throw new Error('Unexpected message size or server ignored the partial request');
    chunks.push(next.source);
    received += next.source.length;
    progress(received, Math.max(reportedSize, received));
  }
  message.source = Buffer.concat(chunks, received);
  message.reportedSize = reportedSize;
  message.size = received;
  message.complete = true;
  return message;
}

async function backup(client, root, config, log = console.log, context = {}) {
  fs.mkdirSync(root, { recursive: true });
  const release = acquireLock(root);
  const manifestPath = path.join(root, 'manifest.json');
  const statusPath = path.join(root, 'last-run.json');
  let progress;
  try { progress = createProgress(root, atomicWrite, context); }
  catch (error) { try { client.close(); } finally { release(); } throw error; }
  const status = { startedAt: context.startedAt, runId: context.runId, success: false, downloaded: context.downloaded, folders: [] };
  const controls = createControl(root, client, progress, readJson);
  try {
    await controls.checkpoint();
    const manifest = readJson(manifestPath, { version: 1, user: config.user, host: config.host, folders: {} });
    if (manifest.user !== config.user || manifest.host !== config.host || manifest.version !== 1)
      throw new Error('Backup identity does not match configuration');
    const selection = normalizeSelection(config.backupOptions);
    status.selection = selection;
    await client.connect();
    await controls.checkpoint();
    progress.publish({ phase: 'discovering' }, true);
    const available = (await client.list()).filter(folder => !folder.flags.has('\\Noselect'));
    atomicWrite(path.join(root, 'mailboxes.json'), JSON.stringify({ updatedAt: new Date().toISOString(), folders: available.map(f => f.path) }));
    const folders = available.filter(f => !selection.folders.length || selection.folders.includes(f.path));
    if (selection.folders.some(f => !available.some(item => item.path === f))) throw new Error('A selected folder is unavailable. Reload folders and update your selection.');
    const plan = [];
    let budget = selection.maxMessages == null ? Infinity : Math.max(0, selection.maxMessages - context.downloaded);
    let remainingMessages = 0;
    let plannedDownloads = 0;
    let alreadyVerified = 0;
    for (const folder of folders) {
      await controls.checkpoint();
      progress.publish({ currentFolder: folder.path }, true);
      const mailboxLock = await client.getMailboxLock(folder.path, { readOnly: true });
      try {
        const validity = String(client.mailbox.uidValidity);
        if (!/^\d+$/.test(validity)) throw new Error('Server did not supply UIDVALIDITY');
        const uids = await client.search(searchForSelection(selection), { uid: true });
        if (!Array.isArray(uids)) throw new Error('Unable to enumerate messages');
        const key = digest(Buffer.from(folder.path, 'utf8')) + '-' + validity;
        const previous = manifest.folders[key]?.messages || {};
        const selected = [];
        for (const uid of [...uids].sort((a, b) => b - a)) {
          await controls.checkpoint();
          if (previous[uid]?.complete !== false && previous[uid] && validateRecord(root, previous[uid])) {
            selected.push(uid); alreadyVerified++;
            progress.publish({ phase: 'checking', alreadyVerified });
          } else if (budget > 0) {
            selected.push(uid); budget--; plannedDownloads++;
          } else remainingMessages++;
        }
        plan.push({ ...folder, validity, uids: selected, matchingMessages: uids.length });
      } finally { mailboxLock.release(); }
    }
    status.remainingMessages = remainingMessages;
    progress.publish({ totalFolders: plan.length, totalMessages: plan.reduce((n, f) => n + f.uids.length, 0), phase: 'downloading',
      plannedDownloads: plannedDownloads + context.downloaded, remainingMessages, alreadyVerified, selection }, true);
    for (const folder of plan) {
      await controls.checkpoint();
      log('Checking folder: ' + folder.path);
      const lock = await client.getMailboxLock(folder.path, { readOnly: true });
      try {
        const validity = String(client.mailbox.uidValidity);
        if (validity !== folder.validity) throw new Error('Mailbox changed during planning. Retry to safely rebuild the plan.');
        const key = digest(Buffer.from(folder.path, 'utf8')) + '-' + validity;
        const saved = manifest.folders[key] ||= { name: folder.path, uidValidity: validity, messages: {} };
        const uids = folder.uids;
        const result = { name: folder.path, uidValidity: validity, serverMessages: uids.length, matchingMessages: folder.matchingMessages, verified: 0, downloaded: 0 };
        status.folders.push(result);
        progress.publish({ currentFolder: folder.path, phase: 'downloading', folders: status.folders }, true);
        for (const uid of uids) {
          await controls.checkpoint();
          const previous = saved.messages[uid];
          const previousValid = previous && validateRecord(root, previous);
          if (previousValid && previous.complete !== false) {
            result.verified++;
            progress.publish({ processedMessages: progress.state.processedMessages + 1 });
            continue;
          }
          if (selection.maxMessages != null && context.downloaded >= selection.maxMessages) {
            status.remainingMessages++;
            progress.publish({ remainingMessages: status.remainingMessages, totalMessages: progress.state.totalMessages - 1 });
            continue;
          }
          status.currentMessage = { folder: folder.path, uid };
          controls.beginMessage();
          let lastProgress = 0;
          let transferred = 0;
          progress.publish({ currentUid: uid, currentMessageBytes: 0, currentMessageTotal: 0 });
          const message = await fetchCompleteMessage(client, uid, (received, total) => {
            context.transferredBytes += Math.max(0, received - transferred);
            transferred = received;
            progress.publish({ currentMessageBytes: received, currentMessageTotal: total });
            if (total < 1024 * 1024) return;
            if (!received) log('  Downloading UID ' + uid + ': ' + (total / 1048576).toFixed(1) + ' MB');
            else if (received - lastProgress >= 1048576 || received === total) {
              lastProgress = received;
              log('    ' + (received / 1048576).toFixed(1) + '/' + (total / 1048576).toFixed(1) + ' MB');
            }
          }, previousValid ? fs.readFileSync(path.resolve(root, previous.file)) : undefined, () => controls.checkpoint(false));
          await controls.checkpoint(false);
          // Concurrent deletion must make the run incomplete, rather than silently claiming full coverage.
          if (!message || message.uid !== uid || !Buffer.isBuffer(message.source) || !message.source.length)
            throw new Error('A message disappeared or could not be fetched; rerun the backup');
          if (!Number.isInteger(message.size) || message.source.length !== message.size)
            throw new Error('Downloaded message size differs from the server');
          if (!/\r?\n\r?\n/.test(message.source.toString('latin1')))
            throw new Error('Downloaded message has no header/body separator');
          const location = messageLocation(folder.path, key, uid, message.source, message.internalDate);
          const relative = location.file;
          const record = { file: relative, bytes: message.source.length, sha256: digest(message.source),
            subject: location.subject,
            sender: location.sender,
            complete: true, downloadMode: 'partial-fetch-with-eof', reportedSize: message.reportedSize,
            internalDate: message.internalDate ? new Date(message.internalDate).toISOString() : null,
            flags: [...(message.flags || [])], backedUpAt: new Date().toISOString() };
          atomicWrite(path.join(root, relative), message.source);
          if (!validateRecord(root, record)) throw new Error('Local message verification failed');
          saved.messages[uid] = record;
          atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
          result.verified++; result.downloaded++; status.downloaded++;
          context.downloaded++;
          context.savedBytes += message.source.length;
          progress.publish({ downloaded: context.downloaded, savedBytes: context.savedBytes,
            processedMessages: progress.state.processedMessages + 1, currentMessageBytes: 0, currentMessageTotal: 0 });
          if (result.downloaded % 25 === 0) log('  Downloaded ' + result.downloaded + ' messages');
          controls.endMessage();
          await controls.checkpoint();
        }
        atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        log('  Verified ' + result.verified + '/' + result.serverMessages + '; new: ' + result.downloaded);
        progress.publish({ completedFolders: progress.state.completedFolders + 1 }, true);
      } finally { lock.release(); }
    }
    if (!status.folders.length) throw new Error('No accessible folders found');
    progress.publish({ phase: 'verifying', currentFolder: null }, true);
    const verified = { checked: 0, invalid: [] };
    for (const folder of Object.values(manifest.folders)) {
      for (const record of Object.values(folder.messages)) {
        await controls.checkpoint();
        verified.checked++;
        if (record.complete === false || !validateRecord(root, record)) verified.invalid.push(record.file);
      }
    }
    status.totalLocalMessages = verified.checked;
    status.invalidLocalFiles = verified.invalid;
    if (verified.invalid.length) throw new Error('Some retained local files are missing or damaged');
    status.success = true;
    status.downloaded = context.downloaded;
    delete status.currentMessage;
    log('Backup complete: ' + status.downloaded + ' downloaded; ' + verified.checked + ' local emails verified.');
    return status;
  } catch (error) {
    const requested = controls.command();
    if (error instanceof RunInterrupted || requested === 'cancel' || requested === 'stop') {
      status.outcome = error.outcome || (requested === 'cancel' ? 'cancelled' : 'stopped');
      status.downloaded = context.downloaded;
      log((status.outcome === 'stopped' ? 'Stopped' : 'Cancelled') + ': completed emails are retained.');
      return status;
    }
    status.error = safeError(error);
    if (client.lastConnectionError) status.error.connectionError = client.lastConnectionError;
    if (client.byeReason) status.error.serverBye = safeError({ message: client.byeReason }).message;
    if (status.error.connectionError) error.connectionDiagnostic = status.error.connectionError;
    throw error;
  } finally {
    controls.dispose();
    status.finishedAt = new Date().toISOString();
    try {
      const outcome = status.outcome || (status.success ? 'completed' : 'failed');
      progress.finish({ state: outcome, phase: outcome, error: status.error || null, currentMessageBytes: 0, currentMessageTotal: 0 });
      atomicWrite(statusPath, JSON.stringify(status, null, 2) + '\n');
    }
    finally { try { client.close(); } finally { release(); } }
  }
}

async function backupWithRetries(makeClient, root, config, log = console.log, wait = sleep) {
  const context = {};
  const transient = new Set(['ETIMEOUT', 'ETIMEDOUT', 'CONNECT_TIMEOUT', 'GREETING_TIMEOUT',
    'NoConnection', 'EConnectionClosed', 'StateLogout', 'ClosedAfterConnectText', 'ClosedAfterConnectTLS',
    'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN']);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await backup(makeClient(), root, config, log, context); }
    catch (error) {
      if (attempt === 3 || error.authenticationFailed || !transient.has(error.code)) throw error;
      const delay = attempt * 30000;
      log('Temporary connection failure (' + error.code + '). Resuming in ' + delay / 1000 + ' seconds; completed downloads are retained.');
      let remaining = delay;
      while (remaining > 0) {
        const requested = readControl(root, context.runId, readJson);
        const snapshot = readJson(path.join(root, 'progress.json'), {});
        if (requested === 'cancel' || requested === 'stop') {
          const outcome = requested === 'cancel' ? 'cancelled' : 'stopped';
          const status = readJson(path.join(root, 'last-run.json'), {});
          delete status.error;
          Object.assign(status, { success: false, outcome, finishedAt: new Date().toISOString() });
          atomicWrite(path.join(root, 'last-run.json'), JSON.stringify(status, null, 2) + '\n');
          atomicWrite(path.join(root, 'progress.json'), JSON.stringify({ ...snapshot, state: outcome, phase: outcome, error: null, updatedAt: new Date().toISOString() }));
          return status;
        }
        const state = requested === 'pause' ? 'paused' : 'retrying';
        atomicWrite(path.join(root, 'progress.json'), JSON.stringify({ ...snapshot, state, phase: state, etaSeconds: null, updatedAt: new Date().toISOString() }));
        const slice = Math.min(250, remaining);
        await wait(slice);
        if (requested === 'pause') context.pausedMs = (context.pausedMs || 0) + slice;
        else remaining -= slice;
      }
    }
  }
}

async function main() {
  const dataDirectory = process.env.MAIL_VAULT_DATA_DIR || __dirname;
  const config = readJson(path.join(dataDirectory, 'backup-config.json'));
  const root = path.resolve(dataDirectory, config.backupDirectory);
  if (process.argv.includes('--verify') || process.argv.includes('--organize')) {
    fs.mkdirSync(root, { recursive: true });
    const release = acquireLock(root);
    try {
      const manifest = readJson(path.join(root, 'manifest.json'));
      if (!manifest) throw new Error('No IMAP backup exists yet');
      if (process.argv.includes('--organize')) console.log('Organized emails: ' + organize(root, manifest));
      const result = verify(root, manifest);
      console.log(JSON.stringify(result, null, 2));
      if (result.invalid.length) process.exitCode = 1;
    } finally { release(); }
    return;
  }
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const credentials = JSON.parse(input.replace(/^\uFEFF/, ''));
  redactions = [credentials.password];
  if (!credentials.password || credentials.user !== config.user) throw new Error('Credentials do not match account');
  const { ImapFlow } = require('imapflow');
  const makeClient = () => {
    const client = new ImapFlow({
    host: config.host, port: config.port, secure: true,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth: { user: credentials.user, pass: credentials.password },
    logger: false, disableAutoIdle: true, disableBinary: true, disableCompression: true,
      connectionTimeout: 30000, socketTimeout: 300000
    });
    client.on('error', error => {
      client.lastConnectionError = safeError(error);
      console.log('Connection diagnostic: ' + JSON.stringify(client.lastConnectionError));
    });
    return client;
  };
  if (process.argv.includes('--list-folders')) {
    fs.mkdirSync(root, { recursive: true });
    const release = acquireLock(root);
    const client = makeClient();
    try {
      await client.connect();
      const folders = (await client.list()).filter(f => !f.flags.has('\\Noselect')).map(f => f.path);
      atomicWrite(path.join(root, 'mailboxes.json'), JSON.stringify({ updatedAt: new Date().toISOString(), folders }));
      console.log('Loaded ' + folders.length + ' mailbox folders.');
    } finally { try { client.close(); } finally { release(); } }
    return;
  }
  await backupWithRetries(makeClient, root, config);
}
if (require.main === module) main().catch(error => {
  console.error('Backup failed. No server emails were deleted.');
  console.error(error.authenticationFailed ? 'Authentication rejected: check your email provider app password and IMAP access settings.' : JSON.stringify(safeError(error)));
  process.exitCode = 1;
});
module.exports = { backup, backupWithRetries, fetchCompleteMessage, verify, digest, readJson, messageLocation, organize };
