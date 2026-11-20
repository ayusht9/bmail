const test = require('node:test');
const assert = require('node:assert/strict');

test('common IMAP folder aliases have distinct icons with a safe custom-folder fallback', async () => {
  const { folderKind, folderIcon } = await import('../src/folder-icons.js');
  for (const [name, expected] of [
    ['INBOX', 'inbox'], ['[Gmail]/Sent Mail', 'sent'], ['INBOX.Drafts', 'drafts'],
    ['Deleted Items', 'trash'], ['Junk Email', 'spam'], ['All Mail', 'archive'],
    ['Starred', 'starred'], ['Important', 'important'], ['Outbox', 'outbox'],
    ['Templates', 'templates'], ['Client invoices', 'folder'], ['Sent invoices', 'folder'],
  ]) assert.equal(folderKind(name), expected, name);
  assert.notEqual(folderIcon('INBOX'), folderIcon('Sent'));
  const unsafe = folderIcon('<img src=x onerror=alert(1)>');
  assert.doesNotMatch(unsafe, /onerror|<img/);
  assert.match(unsafe, /aria-hidden="true"/);
});
