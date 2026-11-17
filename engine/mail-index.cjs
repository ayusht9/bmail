const path = require('node:path');

function readMailIndex(root, readJson) {
  try { return readJson(path.join(root, 'mail-index.json'), null)?.folders || {}; }
  catch { return {}; } // This derived cache can be rebuilt after corruption.
}

async function indexFolder(client, folder, previous = {}, records = {}) {
  const messages = {};
  const missing = [];
  for (const uid of folder.uids) {
    const saved = records[uid];
    const cached = previous.messages?.[uid];
    if (cached) messages[uid] = cached;
    else if (saved?.subject && saved?.sender && saved.complete !== false) {
      messages[uid] = { uid, subject: saved.subject, sender: saved.sender, sentAt: saved.sentAt || null, bytes: saved.bytes || 0 };
    } else missing.push(uid);
  }
  // Fetch metadata only, in bounded batches. Never fetch a body or set a flag.
  for (let offset = 0; offset < missing.length; offset += 200) {
    const batch = missing.slice(offset, offset + 200);
    const expected = new Set(batch);
    for await (const mail of client.fetch(batch.join(','), { envelope: true, size: true }, { uid: true })) {
      if (!expected.has(mail.uid)) continue;
      const envelope = mail.envelope || {};
      const date = new Date(envelope.date || NaN);
      messages[mail.uid] = { uid: mail.uid, subject: envelope.subject || 'No subject',
        sender: envelope.from?.map(sender => sender.address || sender.name || '').filter(Boolean).join(', ') || 'Unknown sender',
        sentAt: Number.isFinite(date.getTime()) ? date.toISOString() : null, bytes: mail.size || 0 };
    }
  }
  if (folder.uids.some(uid => !messages[uid])) throw new Error('The mailbox changed while loading message headers. Check the mailbox again.');
  return { name: folder.name, uidValidity: folder.uidValidity, newUids: folder.newUids, messages };
}

module.exports = { readMailIndex, indexFolder };
