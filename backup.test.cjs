const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { messageLocation, organize, verify, digest, backup, backupWithRetries } = require('./backup.cjs');
const { setTimeout: wait } = require('node:timers/promises');
const key = 'a'.repeat(64) + '-1';

test('decoded subjects, India month boundaries, and Windows filenames', () => {
  const source = Buffer.from('From: Accounts Team <accounts@example.com>\r\nDate: Sat, 31 Oct 2026 23:30:00 +0000\r\nSubject: =?UTF-8?B?SW52b2ljZTogT2N0b2Jlcg==?=\r\n\r\nbody');
  const result = messageLocation('INBOX', key, 42, source);
  assert.equal(result.subject, 'Invoice: October');
  assert.equal(result.sender, 'accounts@example.com');
  assert.equal(result.file, path.join('messages', 'INBOX__aaaaaaaaaaaa-1', '2026-11', '2026-11-01_accounts@example.com_Invoice_ October__42.eml'));
  assert.notEqual(result.file, messageLocation('INBOX', key, 43, source).file);
  const fallback = messageLocation('Sent', key, 1, Buffer.from('Date: invalid\nSubject: \n\nbody'), '2026-03-01T00:00:00Z');
  assert.ok(fallback.file.endsWith('2026-03-01_Unknown sender_No subject__1.eml'));
  assert.equal(messageLocation('Sent', key, 1, Buffer.from('From: person@example.com\r\n\r\nbody')).sender, 'person@example.com');
  assert.equal(messageLocation('Sent', key, 1, Buffer.from('From: =?UTF-8?B?QWxpY2U=?=\r\n\r\nbody')).sender, 'Alice');
  assert.ok(messageLocation('Sent', key, 1, Buffer.from('\n\nbody')).file.includes('Unknown-month'));
});

function requestControl(root, command) {
  const progress = JSON.parse(fs.readFileSync(path.join(root, 'progress.json')));
  fs.writeFileSync(path.join(root, 'control.json'), JSON.stringify({ runId: progress.runId, command }));
}

test('pause holds a partial message and resumes without changing email bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-pause-'));
  const source = Buffer.concat([Buffer.from('Subject: Pause\r\n\r\n'), Buffer.alloc(700000, 'x')]);
  let chunkCalls = 0;
  let run;
  try {
    const client = mockMailbox({ INBOX: { 1: source } }, (folder, uid, query) => {
      if (query.source) { chunkCalls++; if (chunkCalls === 1) requestControl(root, 'pause'); }
    });
    run = backup(client, root, { user: 'test@example.com', host: 'imap.example.com' }, () => {});
    for (let i = 0; i < 200; i++) {
      if (JSON.parse(fs.readFileSync(path.join(root, 'progress.json'))).state === 'paused') break;
      await wait(10);
    }
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'progress.json'))).state, 'paused');
    const pausedCalls = chunkCalls;
    await wait(60);
    assert.equal(chunkCalls, pausedCalls);
    requestControl(root, 'resume');
    assert.equal((await run).success, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
    const record = Object.values(Object.values(manifest.folders)[0].messages)[0];
    assert.deepEqual(fs.readFileSync(path.join(root, record.file)), source);
  } finally {
    if (run) { requestControl(root, 'cancel'); await run.catch(() => {}); }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stop finishes the current email and a new run ignores stale controls and continues safely', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-stop-'));
  const source = Buffer.concat([Buffer.from('Subject: Stop\r\n\r\n'), Buffer.alloc(600000, 'y')]);
  let requested = false;
  try {
    const stopped = await backup(mockMailbox({ INBOX: { 1: source, 2: source } }, (folder, uid, query) => {
      if (!requested && query.source) { requested = true; requestControl(root, 'stop'); }
    }), root, { user: 'test@example.com', host: 'imap.example.com' }, () => {});
    assert.equal(stopped.outcome, 'stopped');
    assert.equal(stopped.success, false);
    assert.equal(stopped.downloaded, 1);
    assert.equal(verify(root, JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')))).checked, 1);
    assert.equal(fs.existsSync(path.join(root, '.backup.lock')), false);
    const resumed = await backup(mockMailbox({ INBOX: { 1: source, 2: source } }), root,
      { user: 'test@example.com', host: 'imap.example.com' }, () => {});
    assert.equal(resumed.success, true);
    assert.equal(resumed.downloaded, 1);
    assert.deepEqual(verify(root, JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')))), { checked: 2, invalid: [] });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cancel aborts a blocked transfer and keeps previously committed emails', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-cancel-'));
  const source = Buffer.from('Subject: Cancel\r\n\r\nOriginal');
  let rejectTransfer;
  try {
    const client = mockMailbox({ INBOX: { 1: source, 2: source } }, (folder, uid, query) => {
      if (uid === 1 && query.source) {
        requestControl(root, 'cancel');
        return new Promise((resolve, reject) => { rejectTransfer = reject; });
      }
    });
    client.close = () => rejectTransfer?.(Object.assign(new Error('Connection closed'), { code: 'NoConnection' }));
    const result = await backup(client, root, { user: 'test@example.com', host: 'imap.example.com' }, () => {});
    assert.equal(result.outcome, 'cancelled');
    assert.equal(result.downloaded, 1);
    assert.equal(result.error, undefined);
    assert.deepEqual(verify(root, JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')))), { checked: 1, invalid: [] });
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'progress.json'))).state, 'cancelled');
    assert.equal(fs.existsSync(path.join(root, '.backup.lock')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cancel during reconnect delay prevents another connection attempt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-retry-cancel-'));
  let attempts = 0;
  try {
    const result = await backupWithRetries(() => {
      attempts++;
      const client = mockMailbox({ INBOX: {} });
      client.connect = async () => { throw Object.assign(new Error('Test timeout'), { code: 'ETIMEDOUT' }); };
      return client;
    }, root, { user: 'test@example.com', host: 'imap.example.com' }, () => {}, async () => requestControl(root, 'cancel'));
    assert.equal(attempts, 1);
    assert.equal(result.outcome, 'cancelled');
    assert.equal(result.error, undefined);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'progress.json'))).state, 'cancelled');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function mockMailbox(folders, onFetch = () => {}, onSearch = () => {}) {
  let current;
  const client = {
    mailbox: null, connect: async () => {}, close: () => {},
    list: async () => Object.keys(folders).map(name => ({ path: name, flags: new Set() })),
    getMailboxLock: async (name, options) => {
      assert.equal(options.readOnly, true);
      current = name; client.mailbox = { uidValidity: 1 };
      return { release() {} };
    },
    search: async query => onSearch(current, query) || Object.keys(folders[current]).map(Number),
    fetchOne: async (uid, query) => {
      await onFetch(current, uid, query);
      const source = folders[current][uid];
      if (!query.source) return { uid, size: source.length, internalDate: new Date('2026-11-01T00:00:00Z'), flags: [] };
      return { uid, source: source.subarray(query.source.start, query.source.start + query.source.maxLength), partialOrigins: new Map([['', query.source.start]]) };
    },
  };
  return client;
}

test('advanced folder exclusions and oldest-first limits are enforced and recorded in account history', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-advanced-'));
  const message = Buffer.from('Subject: Filtered\r\n\r\nSaved mail');
  const fetched = [];
  try {
    const client = () => mockMailbox({ INBOX: { 1: message, 2: message, 3: message }, Sent: { 4: message } }, (folder, uid, query) => {
      assert.equal(folder, 'INBOX'); if (!query.source) fetched.push(uid);
    }, (folder, query) => { assert.equal(folder, 'INBOX'); assert.equal(query.seen, false); assert.equal(query.from, 'billing@example.com'); });
    const config = { user: 'fixture@example.com', host: 'imap.example.com', backupOptions: { maxMessages: 1,
      advanced: { excludedFolders: ['Sent'], order: 'oldest', unreadOnly: true, sender: 'billing@example.com' } } };
    const first = await backup(client(), root, config, () => {});
    assert.equal(first.success, true); assert.equal(first.remainingMessages, 2); assert.deepEqual(fetched, [1]);
    await backup(client(), root, config, () => {});
    assert.deepEqual(fetched, [1, 2]);
    const history = JSON.parse(fs.readFileSync(path.join(root, 'history.json')));
    assert.equal(history.length, 2);
    assert.equal(history[0].outcome, 'completed'); assert.equal(history[0].downloaded, 1);
    assert.equal(history[0].scope.excludedFolderCount, 1);
    assert.deepEqual(history[0].scope.filters, ['unreadOnly', 'sender']);
    assert.ok(!JSON.stringify(history).includes('billing@example.com'), 'Filter values are not copied into history metadata');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('configured retry limits are applied and retries update one history entry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-retry-options-'));
  let attempts = 0;
  const delays = [];
  try {
    const client = () => ({ connect: async () => { attempts++; throw Object.assign(new Error('Fixture reset'), { code: 'ECONNRESET' }); }, close() {} });
    await assert.rejects(backupWithRetries(client, root, { user: 'fixture@example.com', host: 'imap.example.com',
      backupOptions: { advanced: { retryAttempts: 2, retryDelaySeconds: 1 } } }, () => {}, async delay => { delays.push(delay); }), /Fixture reset/);
    assert.equal(attempts, 2); assert.equal(delays.reduce((sum, delay) => sum + delay, 0), 1000);
    const history = JSON.parse(fs.readFileSync(path.join(root, 'history.json')));
    assert.equal(history.length, 1); assert.equal(history[0].outcome, 'failed'); assert.equal(history[0].error.code, 'ECONNRESET');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('live progress discovers the full workload and publishes verified downloads before completion', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-progress-'));
  const message = Buffer.from('Subject: Example\r\n\r\nOriginal bytes');
  const observed = [];
  try {
    const client = mockMailbox({ INBOX: { 1: message, 2: message }, Sent: { 3: message } }, () => {
      observed.push(JSON.parse(fs.readFileSync(path.join(root, 'progress.json'))));
    });
    const result = await backup(client, root, { user: 'test@example.com', host: 'imap.example.com' }, () => {});
    assert.equal(result.success, true);
    assert.equal(result.downloaded, 3);
    assert.ok(observed.every(p => p.totalMessages === 3 && p.totalFolders === 2));
    assert.ok(observed.some(p => p.downloaded > 0 && p.state === 'running'));
    const progress = JSON.parse(fs.readFileSync(path.join(root, 'progress.json')));
    assert.equal(progress.state, 'completed');
    assert.equal(progress.processedMessages, 3);
    assert.equal(progress.downloaded, 3);
    assert.equal(progress.savedBytes, message.length * 3);
    assert.equal(fs.existsSync(path.join(root, '.backup.lock')), false);
    const second = await backup(mockMailbox({ INBOX: { 1: message, 2: message }, Sent: { 3: message } }), root,
      { user: 'test@example.com', host: 'imap.example.com' }, () => {});
    assert.equal(second.downloaded, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'progress.json'))).processedMessages, 3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('selection limits new downloads, uses inclusive received dates, and continues the next batch without deleting saved mail', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-selection-'));
  const source = Buffer.from('Subject: Selection\r\n\r\nOriginal email');
  const folders = { INBOX: { 1: source, 2: source, 3: source, 4: source, 5: source }, Sent: { 6: source } };
  const config = { user: 'test@example.com', host: 'imap.example.com', backupOptions: {
    folders: ['INBOX'], dateFrom: '2026-01-01', dateTo: '2026-11-01', maxMessages: 2,
  } };
  const fetched = [];
  const client = () => mockMailbox(folders, (folder, uid, query) => {
    assert.equal(folder, 'INBOX');
    if (!query.source) fetched.push(uid);
  }, (folder, query) => {
    assert.equal(folder, 'INBOX');
    assert.equal(query.since.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(query.before.toISOString(), '2026-11-02T00:00:00.000Z');
  });
  try {
    const first = await backup(client(), root, config, () => {});
    assert.equal(first.downloaded, 2);
    assert.equal(first.remainingMessages, 3);
    assert.deepEqual(fetched, [5, 4]);
    fetched.length = 0;
    const second = await backup(client(), root, config, () => {});
    assert.equal(second.downloaded, 2);
    assert.equal(second.remainingMessages, 1);
    assert.deepEqual(fetched, [3, 2]);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
    assert.equal(verify(root, manifest).checked, 4);
    assert.deepEqual(verify(root, manifest).invalid, []);
    assert.ok(Object.values(manifest.folders).every(folder => folder.name === 'INBOX'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('migration preserves bytes, updates manifest, and is repeatable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'email-organize-test-'));
  try {
    const source = Buffer.from('Subject: Example\r\nDate: 1 Oct 2026 12:00:00 +0530\r\n\r\nOriginal body\x00');
    fs.writeFileSync(path.join(root, 'old.eml'), source);
    const manifest = { folders: { [key]: { name: 'INBOX', messages: {
      1: { file: 'old.eml', bytes: source.length, sha256: digest(source) }
    } } } };
    assert.equal(organize(root, manifest), 1);
    assert.deepEqual(verify(root, manifest), { checked: 1, invalid: [] });
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
    assert.deepEqual(saved, manifest);
    assert.deepEqual(fs.readFileSync(path.join(root, saved.folders[key].messages[1].file)), source);
    assert.equal(fs.existsSync(path.join(root, 'old.eml')), false);
    assert.equal(organize(root, manifest), 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
