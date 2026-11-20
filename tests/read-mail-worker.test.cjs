const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { listMailPage } = require('../engine/read-mail.cjs');

function fixture(count) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-reader-'));
  const root = path.join(data, 'backups');
  fs.mkdirSync(path.join(root, 'messages'), { recursive: true });
  fs.writeFileSync(path.join(data, 'backup-config.json'), JSON.stringify({ user: 'reader@example.test', backupDirectory: 'backups' }));
  const write = total => {
    const messages = {};
    for (let uid = 1; uid <= total; uid++) {
      const file = `messages/${uid}.eml`;
      const source = `Subject: Message ${uid}\r\n\r\nBody ${uid}`;
      fs.writeFileSync(path.join(root, file), source);
      messages[uid] = { file, bytes: Buffer.byteLength(source), subject: `Message ${uid}`, sender: 'a@example.test', sentAt: new Date(Date.UTC(2026, 0, uid)).toISOString() };
    }
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ folders: { inbox: { name: 'INBOX', messages } } }));
  };
  write(count);
  return { data, root, write };
}

test('cached mail pages reflect manifest changes and never list symbolic-link escapes as backed up', async () => {
  const { data, root, write } = fixture(3);
  try {
    let page = await listMailPage(root, { pageSize: 25 });
    assert.deepEqual(page.rows.map(row => row.subject), ['Message 3', 'Message 2', 'Message 1']);
    assert.ok(page.rows.every(row => row.backedUp));
    assert.equal((await listMailPage(root, { pageSize: 25, sortColumn: 'subject', sortDirection: 'asc' })).rows[0].subject, 'Message 1');
    write(5);
    page = await listMailPage(root, { pageSize: 25 });
    assert.equal(page.total, 5, 'A replaced manifest invalidates the cached list');
    assert.equal(page.rows[0].subject, 'Message 5');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
    manifest.folders.inbox.messages[9] = { file: '../outside.eml', bytes: 4, subject: 'Escape', sender: 'x' };
    fs.writeFileSync(path.join(data, 'outside.eml'), 'evil');
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    page = await listMailPage(root, { pageSize: 25, sortColumn: 'subject', sortDirection: 'asc' });
    assert.equal(page.rows.find(row => row.subject === 'Escape').backedUp, false);
  } finally { fs.rmSync(data, { recursive: true, force: true }); }
});

test('the reader worker answers line-delimited requests in order and reports errors without exiting', async () => {
  const { data } = fixture(60);
  const child = spawn(process.execPath, [path.join(__dirname, '../engine/read-mail.cjs'), '--serve'], { stdio: ['pipe', 'pipe', 'ignore'] });
  try {
    let buffer = '';
    const pending = [];
    child.stdout.on('data', chunk => {
      buffer += chunk;
      for (let index; (index = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(index + 1)) pending.shift()(JSON.parse(buffer.slice(0, index)));
    });
    let id = 0;
    const ask = request => new Promise(resolve => { pending.push(resolve); child.stdin.write(JSON.stringify({ id: ++id, data, request }) + '\n'); });
    const first = await ask({ kind: 'page', page: 2, pageSize: 25, sortColumn: 'sentAt', sortDirection: 'desc' });
    assert.equal(first.id, 1);
    assert.equal(first.result.total, 60);
    assert.equal(first.result.rows[0].subject, 'Message 35');
    const missing = await ask({ kind: 'message', file: '../backup-config.json' });
    assert.deepEqual([missing.id, missing.ok], [2, false]);
    assert.match(missing.error, /not in the saved mailbox/);
    const message = await ask({ kind: 'message', file: 'messages/7.eml' });
    assert.equal(message.id, 3);
    assert.equal(message.result.subject, 'Message 7');
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.stdin.end();
    assert.equal(await exited, 0, 'Closing stdin stops the worker');
  } finally { child.kill(); fs.rmSync(data, { recursive: true, force: true }); }
});
