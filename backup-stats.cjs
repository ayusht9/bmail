const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// The caller holds the backup lock and supplies a connected read-only client.
async function checkMailbox(client, root, manifest, { readJson, atomicWrite, validateRecord }) {
  const filename = path.join(root, 'mailbox-status.json');
  const previous = readJson(filename, null);
  const folders = [];
  const available = (await client.list()).filter(folder => !folder.flags.has('\\Noselect'));
  if (!available.length) throw new Error('No accessible mailbox folders found.');
  for (const folder of available) {
    const lock = await client.getMailboxLock(folder.path, { readOnly: true });
    try {
      const uidValidity = String(client.mailbox.uidValidity);
      if (!/^\d+$/.test(uidValidity)) throw new Error('Server did not supply UIDVALIDITY');
      const uids = await client.search({ all: true }, { uid: true });
      if (!Array.isArray(uids)) throw new Error('Unable to enumerate mailbox messages');
      const key = crypto.createHash('sha256').update(folder.path).digest('hex') + '-' + uidValidity;
      const records = manifest?.folders?.[key]?.messages || {};
      const saved = uids.filter(uid => records[uid] && records[uid].complete !== false && validateRecord(root, records[uid])).length;
      const earlier = previous?.folders?.find(item => item.name === folder.path && item.uidValidity === uidValidity);
      const known = new Set(earlier?.uids || []);
      const reset = !earlier && previous?.folders?.some(item => item.name === folder.path);
      folders.push({ name: folder.path, uidValidity, uids, serverMessages: uids.length, savedMessages: saved,
        missingMessages: uids.length - saved, newMessages: previous && !reset ? (earlier ? uids.filter(uid => !known.has(uid)).length : uids.length) : null });
    } finally { lock.release(); }
  }
  const checkedAt = new Date().toISOString();
  const total = field => folders.reduce((sum, folder) => sum + (folder[field] || 0), 0);
  const complete = folders.every(folder => folder.missingMessages === 0);
  const snapshot = { checkedAt, previousCheckedAt: previous?.checkedAt || null, totalServerMessages: total('serverMessages'),
    savedMessages: total('savedMessages'), missingMessages: total('missingMessages'), newMessages: folders.every(folder => folder.newMessages !== null) ? total('newMessages') : null,
    complete, lastFullBackupAt: complete ? checkedAt : previous?.lastFullBackupAt || null, folders };
  atomicWrite(filename, JSON.stringify(snapshot, null, 2) + '\n');
  return snapshot;
}
module.exports = { checkMailbox };
