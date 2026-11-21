const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readMailIndex, indexFolder } = require('./mail-index.cjs');

// The caller holds the backup lock and supplies a connected read-only client.
async function checkMailbox(client, root, manifest, { readJson, atomicWrite, validateRecord, newMailOnly = false, indexMessages = false }) {
  const coverageFile = path.join(root, 'mailbox-status.json');
  const filename = newMailOnly ? path.join(root, 'new-mail-status.json') : coverageFile;
  let previous = readJson(filename, null);
  if (newMailOnly) {
    const coverage = readJson(coverageFile, null);
    if (coverage && (!previous || coverage.checkedAt > previous.checkedAt)) previous = coverage;
  }
  const folders = [];
  const previousIndex = indexMessages ? readMailIndex(root, readJson) : {};
  const indexedFolders = {};
  const available = (await client.list()).filter(folder => !folder.flags.has('\\Noselect'));
  if (!available.length) throw new Error('No accessible mailbox folders found.');
  for (const folder of available) {
    const lock = await client.getMailboxLock(folder.path, { readOnly: true });
    try {
      const uidValidity = String(client.mailbox.uidValidity);
      if (!/^\d+$/.test(uidValidity)) throw new Error('Server did not supply UIDVALIDITY');
      const earlier = previous?.folders?.find(item => item.name === folder.path && item.uidValidity === uidValidity);
      const uidNext = Number(client.mailbox.uidNext);
      const exists = Number(client.mailbox.exists);
      const checkpoint = Number(earlier?.uidNext);
      const fullCheckedAt = earlier?.fullCheckedAt || previous?.checkedAt;
      const recent = Date.now() - Date.parse(fullCheckedAt) < 30 * 60 * 1000;
      let incremental = newMailOnly && recent && Array.isArray(earlier?.uids)
        && Number.isSafeInteger(checkpoint) && checkpoint > 0
        && Number.isSafeInteger(uidNext) && uidNext >= checkpoint
        && Number.isSafeInteger(exists) && exists >= earlier.uids.length;
      let uids;
      if (incremental) {
        const added = uidNext > checkpoint ? await client.search({ uid: `${checkpoint}:*` }, { uid: true }) : [];
        if (!Array.isArray(added)) throw new Error('Unable to enumerate mailbox messages');
        // IMAP n:* may include the last existing UID when n is above it.
        uids = [...new Set([...earlier.uids, ...added.filter(uid => uid >= checkpoint)])];
        incremental = uids.length === exists;
      }
      if (!incremental) uids = await client.search({ all: true }, { uid: true });
      if (!Array.isArray(uids)) throw new Error('Unable to enumerate mailbox messages');
      const key = crypto.createHash('sha256').update(folder.path).digest('hex') + '-' + uidValidity;
      const records = manifest?.folders?.[key]?.messages || {};
      const saved = newMailOnly ? 0 : uids.filter(uid => records[uid] && records[uid].complete !== false && validateRecord(root, records[uid])).length;
      const known = new Set(earlier?.uids || []);
      const reset = !earlier && previous?.folders?.some(item => item.name === folder.path);
      const newUids = previous && !reset ? (earlier ? uids.filter(uid => !known.has(uid)) : uids) : [];
      const summary = { name: folder.path, uidValidity, uidNext: Number.isSafeInteger(uidNext) ? uidNext : null,
        fullCheckedAt: incremental ? fullCheckedAt : new Date().toISOString(), uids, newUids, serverMessages: uids.length, savedMessages: saved,
        missingMessages: uids.length - saved, newMessages: previous && !reset ? newUids.length : null };
      folders.push(summary);
      if (indexMessages) indexedFolders[key] = await indexFolder(client, summary, previousIndex[key], records);
    } finally { lock.release(); }
  }
  const checkedAt = new Date().toISOString();
  if (indexMessages) atomicWrite(path.join(root, 'mail-index.json'), JSON.stringify({ checkedAt, folders: indexedFolders }) + '\n');
  const total = field => folders.reduce((sum, folder) => sum + (folder[field] || 0), 0);
  const complete = folders.every(folder => folder.missingMessages === 0);
  if (newMailOnly) {
    const snapshot = { checkedAt, previousCheckedAt: previous?.checkedAt || null, folders: folders.map(({ name, uidValidity, uidNext, fullCheckedAt, uids, newUids, newMessages }) => ({ name, uidValidity, uidNext, fullCheckedAt, uids, newUids, newMessages })) };
    atomicWrite(filename, JSON.stringify(snapshot, null, 2) + '\n');
    return snapshot;
  }
  const snapshot = { checkedAt, previousCheckedAt: previous?.checkedAt || null, totalServerMessages: total('serverMessages'),
    savedMessages: total('savedMessages'), missingMessages: total('missingMessages'), newMessages: folders.every(folder => folder.newMessages !== null) ? total('newMessages') : null,
    complete, lastFullBackupAt: complete ? checkedAt : previous?.lastFullBackupAt || null, folders };
  atomicWrite(filename, JSON.stringify(snapshot, null, 2) + '\n');
  return snapshot;
}
module.exports = { checkMailbox };
