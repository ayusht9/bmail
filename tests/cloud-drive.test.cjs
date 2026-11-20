const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DriveClient, DriveError, oauthRequest, tokenRequest, validSession, SCOPE } = require('../engine/drive-client.cjs');
const { run, publicStatus, authorize, archiveFiles, credentialStore, readJson, writeJson, syncAfterBackup } = require('../engine/cloud-drive.cjs');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const md5 = data => crypto.createHash('md5').update(data).digest('hex');
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const clientConfig = { clientId: 'fixture-client.apps.googleusercontent.com', clientSecret: 'fixture-desktop-client' };

function fakeDrive() {
  const files = new Map(), sessions = new Map();
  let serial = 0, uploads = 0, loseChunk = false, corrupt = false;
  const fetcher = async (address, options = {}) => {
    const url = new URL(address), method = options.method || 'GET';
    if (url.hostname === 'oauth2.googleapis.com') return json({ access_token: 'fixture-access', expires_in: 3600, scope: SCOPE });
    assert.equal(options.headers.Authorization, 'Bearer fixture-access');
    if (url.pathname.endsWith('/about')) return json({ user: { emailAddress: 'drive@example.test' } });
    if (url.pathname.endsWith('/generateIds')) return json({ ids: ['file' + ++serial] });
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const key = /value='([^']+)'/.exec(url.searchParams.get('q'))[1];
      return json({ files: [...files.values()].filter(file => !file.trashed && file.appProperties.bmailKey === key) });
    }
    if (method === 'GET' && url.pathname.startsWith('/drive/v3/files/')) return files.has(url.pathname.split('/').pop()) ? json(files.get(url.pathname.split('/').pop())) : json({}, 404);
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const data = JSON.parse(options.body);
      if (files.has(data.id)) return json({}, 409);
      files.set(data.id, data); return json({ id: data.id });
    }
    if (url.pathname.startsWith('/upload/drive/v3/files') && ['POST', 'PATCH'].includes(method)) {
      const metadata = JSON.parse(options.body);
      const id = metadata.id || url.pathname.split('/').pop();
      if (method === 'POST' && files.has(id)) return json({}, 409);
      const session = 'session' + ++serial;
      sessions.set(session, { id, metadata: { ...files.get(id), ...metadata, id }, data: Buffer.alloc(0), size: Number(options.headers['X-Upload-Content-Length']) });
      uploads++;
      return new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=' + session } });
    }
    if (method === 'PUT') {
      const session = sessions.get(url.searchParams.get('upload_id'));
      assert.ok(session, 'Only upload to a previously negotiated session');
      const range = options.headers['Content-Range'];
      const complete = () => {
        const file = { ...session.metadata, size: String(session.size), md5Checksum: corrupt ? 'bad-checksum' : md5(session.data), data: session.data };
        files.set(file.id, file); return json(file);
      };
      if (range.startsWith('bytes */')) return session.data.length === session.size ? complete() : new Response(null, { status: 308, headers: session.data.length ? { range: `bytes=0-${session.data.length - 1}` } : {} });
      const start = Number(/^bytes (\d+)-/.exec(range)[1]);
      if (start !== session.data.length) return json({}, 416);
      session.data = Buffer.concat([session.data, options.body]);
      if (loseChunk) { loseChunk = false; throw new Error('Simulated lost upload response'); }
      return session.data.length === session.size ? complete() : new Response(null, { status: 308, headers: { range: `bytes=0-${session.data.length - 1}` } });
    }
    assert.fail('Unexpected Drive request: ' + method + ' ' + url.pathname);
  };
  return { fetcher, files, uploads: () => uploads, loseNextChunk: () => { loseChunk = true; }, corruptChecksum: () => { corrupt = true; } };
}

function fixture() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-drive-'));
  const root = path.join(data, 'custom archive');
  fs.mkdirSync(path.join(root, 'messages', 'INBOX', '2026-11'), { recursive: true });
  const source = Buffer.from('From: fixture@example.test\r\nSubject: Cloud copy\r\n\r\nOriginal email bytes');
  const relative = path.join('messages', 'INBOX', '2026-11', 'saved.eml');
  fs.writeFileSync(path.join(root, relative), source);
  const config = { user: 'mailbox@example.test', host: 'imap.example.test', backupDirectory: 'custom archive' };
  const manifest = { version: 1, user: config.user, host: config.host, folders: { inbox: { name: 'INBOX', messages: { 42: { file: relative, bytes: source.length, sha256: sha(source) } } } } };
  writeJson(path.join(root, 'manifest.json'), manifest); writeJson(path.join(data, 'backup-config.json'), config);
  writeJson(path.join(data, 'cloud-drive.json'), { configured: true, connected: true, automatic: true, stage: 'ready' });
  let credentials = { ...clientConfig, refreshToken: 'fixture-refresh', accessToken: 'fixture-access', expiresAt: Date.now() + 3600000 };
  const store = async (ignored, action, value) => { if (action === 'save') credentials = structuredClone(value); return structuredClone(credentials); };
  return { data, root, source, relative, config, manifest, store, credentials: () => credentials, cleanup: () => fs.rmSync(data, { recursive: true, force: true }) };
}

test('desktop OAuth uses PKCE, offline access, state, and a loopback callback', async () => {
  let authorization;
  const credentials = await authorize(clientConfig, {
    browser: async address => {
      authorization = new URL(address);
      assert.equal(authorization.origin, 'https://accounts.google.com');
      assert.equal(authorization.searchParams.get('scope'), SCOPE);
      assert.equal(authorization.searchParams.get('access_type'), 'offline');
      const callback = new URL(authorization.searchParams.get('redirect_uri'));
      assert.equal(callback.hostname, '127.0.0.1');
      callback.search = new URLSearchParams({ state: 'wrong-state', code: 'wrong-code' });
      assert.equal((await fetch(callback)).status, 400);
      callback.search = new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'fixture-code' });
      assert.equal((await fetch(callback)).status, 200);
    },
    fetcher: async (address, options) => {
      assert.equal(address, 'https://oauth2.googleapis.com/token');
      assert.equal(options.body.get('code'), 'fixture-code');
      assert.equal(crypto.createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'));
      return json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, scope: SCOPE });
    },
  });
  assert.equal(credentials.refreshToken, 'fixture-refresh');
  await assert.rejects(authorize(clientConfig, { browser: async () => {}, timeout: 5 }), { code: 'timeout' });
  await assert.rejects(tokenRequest({}, async () => json({ error: 'invalid_grant', private: 'never echo' }, 400)), error => error.code === 'auth' && !error.message.includes('never echo'));
  assert.throws(() => oauthRequest({ clientId: 'invalid' }, 'http://127.0.0.1/'), { code: 'client' });
});

test('Drive sync preserves folder policy, uploads only verified mail and manifest, skips unchanged files, and updates changed files', async () => {
  const f = fixture(), drive = fakeDrive();
  try {
    fs.writeFileSync(path.join(f.root, 'credentials.json'), 'must not upload');
    fs.writeFileSync(path.join(f.root, 'debug.log'), 'must not upload');
    const before = fs.readFileSync(path.join(f.data, 'backup-config.json'));
    const first = await run(f.data, 'sync', null, { store: f.store, fetcher: drive.fetcher });
    assert.equal(first.stage, 'ready'); assert.equal(first.completedFiles, 2); assert.equal(first.skippedFiles, 0);
    assert.equal(drive.uploads(), 2);
    const emails = [...drive.files.values()].filter(file => file.name === 'saved.eml');
    assert.equal(emails.length, 1); assert.deepEqual(emails[0].data, f.source);
    const month = drive.files.get(emails[0].parents[0]);
    assert.equal(month.name, '2026-11'); assert.equal(drive.files.get(month.parents[0]).name, 'INBOX');
    assert.ok([...drive.files.values()].some(file => file.name === 'manifest.json'));
    assert.ok(![...drive.files.values()].some(file => file.name === 'credentials.json' || file.name === 'debug.log'));
    assert.deepEqual(fs.readFileSync(path.join(f.data, 'backup-config.json')), before);
    const second = await run(f.data, 'sync', null, { store: f.store, fetcher: drive.fetcher });
    assert.equal(second.skippedFiles, 2); assert.equal(drive.uploads(), 2);
    const changed = Buffer.from('Subject: Updated\r\n\r\nRepaired local mail');
    fs.writeFileSync(path.join(f.root, f.relative), changed);
    Object.assign(f.manifest.folders.inbox.messages[42], { bytes: changed.length, sha256: sha(changed) });
    writeJson(path.join(f.root, 'manifest.json'), f.manifest);
    const third = await run(f.data, 'sync', null, { store: f.store, fetcher: drive.fetcher });
    assert.equal(third.stage, 'ready'); assert.equal(drive.uploads(), 4);
    assert.deepEqual(drive.files.get(emails[0].id).data, changed);
    assert.equal([...drive.files.values()].filter(file => file.name === 'saved.eml').length, 1);
  } finally { f.cleanup(); }
});

test('resumable uploads recover a lost response without duplicating bytes and reject a checksum mismatch', async () => {
  const drive = fakeDrive();
  const client = new DriveClient({ accessToken: 'fixture-access', fetcher: drive.fetcher, wait: async () => {} });
  const data = Buffer.alloc(9 * 1024 * 1024, 'x');
  drive.loseNextChunk();
  const file = { name: 'large.eml', data, size: data.length, md5: md5(data) };
  const result = await client.upload(file, 'parent', 'a'.repeat(64), {}, () => {});
  assert.deepEqual(drive.files.get(result.id).data, data);
  assert.equal(drive.uploads(), 1);
  drive.corruptChecksum();
  await assert.rejects(client.upload({ ...file, name: 'other.eml' }, 'parent', 'b'.repeat(64), {}, () => {}), { code: 'checksum' });
  assert.equal(validSession('https://attacker.invalid/upload/drive/v3/files'), false);
  assert.equal(validSession('http://www.googleapis.com/upload/drive/v3/files'), false);
});

test('unsafe, missing, changed, or incomplete local mail fails before any upload and never changes local backup success', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'last-run.json'), JSON.stringify({ success: true }));
    const record = f.manifest.folders.inbox.messages[42];
    for (const change of [{ file: '../secret.eml' }, { file: '.private/credentials.json' }, { file: 'missing.eml' }, { sha256: '0'.repeat(64) }, { complete: false }]) {
      const original = { ...record }; Object.assign(record, change);
      writeJson(path.join(f.root, 'manifest.json'), f.manifest);
      const status = await run(f.data, 'sync', null, { store: f.store, fetcher: async () => assert.fail('Must validate local files before contacting Drive') });
      assert.equal(status.stage, 'error'); assert.equal(status.errorCode, 'files');
      for (const key of Object.keys(record)) delete record[key]; Object.assign(record, original);
    }
    assert.equal(readJson(path.join(f.root, 'last-run.json')).success, true);
    assert.deepEqual(fs.readFileSync(path.join(f.root, f.relative)), f.source);
  } finally { f.cleanup(); }
});

test('automatic cloud backup is opt-in, queues behind a running upload, and preserves local success on auth failure', async () => {
  const f = fixture(), drive = fakeDrive();
  try {
    await run(f.data, 'automatic', false, { store: f.store });
    await syncAfterBackup(f.data, { store: f.store, fetcher: async () => assert.fail('Automatic upload must be opt-in') });
    assert.equal(drive.uploads(), 0);
    await run(f.data, 'automatic', true, { store: f.store });
    const manual = run(f.data, 'sync', null, { store: f.store, fetcher: drive.fetcher });
    await syncAfterBackup(f.data, { store: f.store, fetcher: drive.fetcher });
    await manual;
    assert.equal(fs.existsSync(path.join(f.data, '.private', 'drive-resync')), false);
    assert.equal(publicStatus(f.data).stage, 'ready');
    assert.equal(publicStatus(f.data).skippedFiles, 2, 'The queued sync checks the latest archive after the first finishes');
    fs.writeFileSync(path.join(f.root, 'last-run.json'), JSON.stringify({ success: true }));
    await f.store(f.data, 'save', { ...f.credentials(), expiresAt: 0 });
    await syncAfterBackup(f.data, { store: f.store, fetcher: async () => json({ error: 'invalid_grant', private: 'never show tokens' }, 400) });
    assert.equal(publicStatus(f.data).connected, false);
    assert.equal(publicStatus(f.data).automatic, false);
    assert.equal(publicStatus(f.data).errorCode, 'auth');
    assert.equal(readJson(path.join(f.root, 'last-run.json')).success, true);
  } finally { f.cleanup(); }
});

test('setup validates a desktop client, cancellation preserves settings, and public status never exposes the imported configuration', async () => {
  const f = fixture();
  try {
    writeJson(path.join(f.data, 'cloud-drive.json'), { configured: false, connected: false });
    const cancelled = await run(f.data, 'setup', null, { store: async () => null });
    assert.equal(cancelled.configured, false);
    let saved;
    const status = await run(f.data, 'setup', null, { store: async (data, action, value) => { if (action === 'import') return clientConfig; saved = value; } });
    assert.equal(status.configured, true); assert.equal(status.connected, false);
    assert.equal(saved.clientId, clientConfig.clientId);
    assert.equal(JSON.stringify(status).includes(clientConfig.clientSecret), false);
  } finally { f.cleanup(); }
});

test('a file trashed on Drive is replaced with a new reserved ID while local email bytes stay intact', async () => {
  const f = fixture(), drive = fakeDrive();
  try {
    await run(f.data, 'sync', null, { store: f.store, fetcher: drive.fetcher });
    const original = [...drive.files.values()].find(file => file.name === 'saved.eml');
    original.trashed = true;
    const result = await run(f.data, 'sync', null, { store: f.store, fetcher: drive.fetcher });
    assert.equal(result.stage, 'ready');
    const restored = [...drive.files.values()].find(file => file.name === 'saved.eml' && !file.trashed);
    assert.notEqual(restored.id, original.id); assert.deepEqual(restored.data, f.source);
  } finally { f.cleanup(); }
});

test('cloud status redacts secrets, records auth failures, prevents concurrent jobs, and disconnect keeps remote/local files', async () => {
  const f = fixture();
  try {
    const state = path.join(f.data, 'cloud-drive.json');
    writeJson(state, { connected: true, automatic: true, refreshToken: 'sensitive', clientSecret: 'sensitive', accessToken: 'sensitive' });
    assert.equal(JSON.stringify(publicStatus(f.data)).includes('sensitive'), false);
    fs.mkdirSync(path.join(f.data, '.private'), { recursive: true });
    fs.writeFileSync(path.join(f.data, '.private', 'drive.lock'), String(process.pid));
    await assert.rejects(run(f.data, 'sync', null, { store: f.store }), { code: 'busy' });
    fs.unlinkSync(path.join(f.data, '.private', 'drive.lock'));
    const status = await run(f.data, 'disconnect', null, { store: f.store, fetcher: async () => json({}) });
    assert.equal(status.connected, false); assert.equal(status.automatic, false);
    assert.equal(f.credentials().refreshToken, undefined);
    assert.deepEqual(fs.readFileSync(path.join(f.root, f.relative)), f.source);
    const notConnected = await run(f.data, 'automatic', true, { store: f.store });
    assert.equal(notConnected.errorCode, 'auth');
    writeJson(state, { configured: true, connected: true, automatic: true });
    const locked = await run(f.data, 'sync', null, { store: async () => { throw new DriveError('credentials'); } });
    assert.equal(locked.connected, false); assert.equal(locked.automatic, false);
    assert.equal(locked.configured, true, 'Unreadable credentials allow the user to import app setup again');
  } finally { f.cleanup(); }
});

test('Drive HTTP handling retries throttled requests, refreshes expired tokens, and returns safe quota errors', async () => {
  let calls = 0, refreshed = 0;
  const client = new DriveClient({ accessToken: 'expired', refresh: async () => { refreshed++; return 'fresh'; }, wait: async () => {}, fetcher: async () => {
    calls++; return calls === 1 ? json({}, 401) : calls === 2 ? json({}, 429) : json({ files: [] });
  } });
  assert.equal(await client.find('a'.repeat(64)), null); assert.equal(refreshed, 1); assert.equal(calls, 3);
  const quota = new DriveClient({ accessToken: 'fixture', wait: async () => {}, fetcher: async () => json({ error: { errors: [{ reason: 'storageQuotaExceeded' }], message: 'private details' } }, 403) });
  await assert.rejects(quota.find('b'.repeat(64)), error => error.code === 'quota' && !error.message.includes('private details'));
});

test('Google Drive credentials are encrypted for the current Windows user and are never returned in cloud status', { skip: process.platform !== 'win32' }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-drive-protect-'));
  try {
    const value = { ...clientConfig, refreshToken: 'fixture-encryption-check' };
    await credentialStore(data, 'save', value);
    const encrypted = fs.readFileSync(path.join(data, '.private', 'google-drive.dat'), 'utf8');
    assert.equal(encrypted.includes(value.refreshToken), false);
    assert.equal(encrypted.includes(value.clientSecret), false);
    assert.deepEqual(await credentialStore(data, 'read'), value);
    assert.equal(JSON.stringify(publicStatus(data)).includes(value.refreshToken), false);
  } finally { fs.rmSync(data, { recursive: true, force: true }); }
});
