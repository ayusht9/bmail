const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DropboxClient, DropboxError, oauthRequest, tokenRequest, contentHash, headerJson, SCOPES, REDIRECT_URI } = require('../engine/dropbox-client.cjs');
const { authorize, run, publicStatus, credentialStore, syncAfterBackup } = require('../engine/cloud-dropbox.cjs');
const drive = require('../engine/cloud-drive.cjs');
const clientId = 'fixture_dropbox_key';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
function referenceHash(bytes) {
  const blocks = [];
  for (let offset = 0; offset < bytes.length; offset += 4194304) blocks.push(Buffer.from(sha(bytes.subarray(offset, offset + 4194304)), 'hex'));
  return sha(Buffer.concat(blocks));
}
function fakeDropbox() {
  const files = new Map(), sessions = new Map();
  let serial = 0, uploads = 0, loseAppend = false, loseFinish = false, quota = false, corrupt = false;
  const fetcher = async (address, options) => {
    const url = new URL(address);
    if (url.pathname === '/oauth2/token') {
      assert.equal(options.body.has('client_secret'), false);
      return json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 14400, scope: SCOPES.join(' ') });
    }
    assert.equal(options.headers.Authorization, 'Bearer fixture-access');
    const content = url.hostname === 'content.dropboxapi.com';
    assert.ok(content || url.hostname === 'api.dropboxapi.com');
    const arg = content ? JSON.parse(options.headers['Dropbox-API-Arg']) : JSON.parse(options.body);
    const route = url.pathname.slice(3);
    if (route === 'users/get_current_account') return json({ email: 'dropbox-fixture@example.test' });
    if (route === 'files/get_metadata') return files.has(arg.path.toLowerCase()) ? json(files.get(arg.path.toLowerCase())) : json({ error: { '.tag': 'path', path: { '.tag': 'not_found' } } }, 409);
    if (route === 'files/create_folder_v2') {
      if (files.has(arg.path.toLowerCase())) return json({ error: { '.tag': 'path', path: { '.tag': 'conflict' } } }, 409);
      const metadata = { '.tag': 'folder', path_display: arg.path, id: 'id:' + ++serial };
      files.set(arg.path.toLowerCase(), metadata); return json({ metadata });
    }
    if (route === 'files/upload_session/start') { uploads++; const session_id = 'upload' + ++serial; sessions.set(session_id, Buffer.alloc(0)); return json({ session_id }); }
    if (route === 'files/upload_session/append_v2') {
      const bytes = sessions.get(arg.cursor.session_id);
      if (!bytes) return json({ error: { '.tag': 'not_found' } }, 409);
      if (arg.cursor.offset !== bytes.length) return json({ error: { '.tag': 'incorrect_offset', correct_offset: bytes.length } }, 409);
      sessions.set(arg.cursor.session_id, Buffer.concat([bytes, options.body]));
      if (loseAppend) { loseAppend = false; throw new Error('Simulated lost append response'); }
      return json(null);
    }
    if (route === 'files/upload_session/finish') {
      if (quota) return json({ error: { '.tag': 'path', path: { '.tag': 'insufficient_space' } } }, 409);
      const bytes = sessions.get(arg.cursor.session_id);
      if (!bytes) return json({ error: { '.tag': 'lookup_failed', lookup_failed: { '.tag': 'not_found' } } }, 409);
      assert.equal(arg.cursor.offset, bytes.length);
      assert.equal(arg.content_hash, referenceHash(bytes));
      assert.equal(arg.commit.autorename, false); assert.equal(arg.commit.strict_conflict, true);
      const previous = files.get(arg.commit.path.toLowerCase());
      if (previous && (arg.commit.mode['.tag'] !== 'update' || arg.commit.mode.update !== previous.rev)) return json({ error: { '.tag': 'path', path: { '.tag': 'conflict' } } }, 409);
      const metadata = { '.tag': 'file', path_display: arg.commit.path, size: bytes.length, content_hash: corrupt ? 'bad-checksum' : referenceHash(bytes), rev: String(++serial), data: bytes };
      files.set(arg.commit.path.toLowerCase(), metadata); sessions.delete(arg.cursor.session_id);
      if (loseFinish) { loseFinish = false; throw new Error('Simulated lost finish response'); }
      return json(metadata);
    }
    assert.fail('Unexpected Dropbox route: ' + route);
  };
  return { fetcher, files, uploads: () => uploads, loseAppend: () => { loseAppend = true; }, loseFinish: () => { loseFinish = true; }, quota: () => { quota = true; }, corrupt: () => { corrupt = true; } };
}
function fixture() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-dropbox-'));
  const root = path.join(data, 'custom archive'), relative = path.join('messages', 'INBOX', '2026-11', 'saved.eml');
  const source = Buffer.from('From: sender@example.test\r\nSubject: Dropbox\r\n\r\nVerified email bytes');
  const config = { user: 'mailbox@example.test', host: 'imap.example.test', backupDirectory: 'custom archive' };
  const manifest = { version: 1, user: config.user, host: config.host, folders: { inbox: { name: 'INBOX', messages: { 42: { file: relative, sha256: sha(source), bytes: source.length } } } } };
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.writeFileSync(path.join(root, relative), source);
  drive.writeJson(path.join(data, 'backup-config.json'), config); drive.writeJson(path.join(root, 'manifest.json'), manifest);
  drive.writeJson(path.join(root, 'last-run.json'), { success: true });
  drive.writeJson(path.join(data, 'cloud-dropbox.json'), { configured: true, connected: true, automatic: true, stage: 'ready' });
  drive.writeJson(path.join(data, 'cloud-drive.json'), { connected: true, automatic: true, stage: 'ready' });
  let credentials = { clientId, accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: Date.now() + 14400000 };
  const store = async (ignored, action, value) => { if (action === 'delete') credentials = null; if (action === 'save') credentials = structuredClone(value); return structuredClone(credentials); };
  return { data, root, relative, source, config, manifest, store, credentials: () => credentials, cleanup: () => fs.rmSync(data, { recursive: true, force: true }) };
}

test('Dropbox desktop OAuth validates callback state and uses offline S256 PKCE without an app secret', async () => {
  let auth;
  const result = await authorize(clientId, { port: 0, browser: async address => {
    auth = new URL(address);
    assert.equal(auth.origin, 'https://www.dropbox.com');
    assert.equal(auth.searchParams.get('token_access_type'), 'offline');
    assert.equal(auth.searchParams.get('scope'), SCOPES.join(' '));
    const callback = new URL(auth.searchParams.get('redirect_uri'));
    assert.equal(callback.hostname, '127.0.0.1'); assert.equal(callback.pathname, '/oauth/dropbox/callback');
    callback.search = new URLSearchParams({ state: 'wrong', code: 'wrong' }); assert.equal((await fetch(callback)).status, 400);
    callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'fixture-code' }); assert.equal((await fetch(callback)).status, 200);
  }, fetcher: async (address, options) => {
    assert.equal(address, 'https://api.dropboxapi.com/oauth2/token'); assert.equal(options.body.has('client_secret'), false);
    assert.equal(options.body.get('client_id'), clientId); assert.equal(options.body.get('code'), 'fixture-code');
    assert.equal(crypto.createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
    return json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 14400, scope: SCOPES.join(' ') });
  } });
  assert.equal(result.refreshToken, 'fixture-refresh');
  assert.equal(REDIRECT_URI, 'http://127.0.0.1:53683/oauth/dropbox/callback');
  assert.equal(oauthRequest(clientId).url.includes('client_secret'), false);
  await assert.rejects(authorize(clientId, { port: 0, timeout: 5, browser: async () => {} }), { code: 'timeout' });
  await assert.rejects(authorize(clientId, { port: 0, browser: async address => {
    const auth = new URL(address), callback = new URL(auth.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), error: 'access_denied' }); await fetch(callback);
  } }), { code: 'auth' });
});

test('Dropbox block hashing covers empty, exact-block and multi-block files; API headers encode Unicode safely', () => {
  for (const data of [Buffer.alloc(0), Buffer.from('hello'), Buffer.alloc(4194304, 'a'), Buffer.concat([Buffer.alloc(4194304, 'a'), Buffer.from('b')])]) {
    assert.equal(contentHash({ data, size: data.length }), referenceHash(data));
  }
  const original = { path: '/Archives/पत्र/😀.eml' }, encoded = headerJson(original);
  assert.ok(!/[^\x00-\x7e]/.test(encoded)); assert.deepEqual(JSON.parse(encoded), original);
});

test('Dropbox archive upload preserves paths, skips unchanged files and updates repaired mail without duplicating it', async () => {
  const f = fixture(), dbx = fakeDropbox(), options = { store: f.store, clientId, fetcher: dbx.fetcher, wait: async () => {} };
  try {
    fs.writeFileSync(path.join(f.root, 'passwords.json'), 'must not upload');
    const googleBefore = fs.readFileSync(path.join(f.data, 'cloud-drive.json'));
    const first = await run(f.data, 'sync', null, options);
    assert.equal(first.stage, 'ready'); assert.equal(first.completedFiles, 2);
    const remote = first.folderName + '/' + f.relative.replace(/\\/g, '/');
    assert.deepEqual(dbx.files.get(remote.toLowerCase()).data, f.source);
    assert.ok(dbx.files.has((first.folderName + '/manifest.json').toLowerCase()));
    assert.equal(dbx.uploads(), 2);
    const second = await run(f.data, 'sync', null, options);
    assert.equal(second.skippedFiles, 2); assert.equal(dbx.uploads(), 2);
    const changed = Buffer.from('Subject: Repaired\r\n\r\nUpdated bytes');
    fs.writeFileSync(path.join(f.root, f.relative), changed); Object.assign(f.manifest.folders.inbox.messages[42], { bytes: changed.length, sha256: sha(changed) });
    drive.writeJson(path.join(f.root, 'manifest.json'), f.manifest);
    const third = await run(f.data, 'sync', null, options);
    assert.equal(third.stage, 'ready'); assert.equal(dbx.uploads(), 4);
    assert.deepEqual(dbx.files.get(remote.toLowerCase()).data, changed);
    assert.equal([...dbx.files.keys()].filter(key => key.endsWith('.eml')).length, 1);
    assert.deepEqual(fs.readFileSync(path.join(f.data, 'cloud-drive.json')), googleBefore);
    assert.ok(![...dbx.files.keys()].some(key => key.endsWith('passwords.json')));
  } finally { f.cleanup(); }
});

test('Dropbox upload resumes after a lost chunk or commit response and verifies the remote content hash', async () => {
  const dbx = fakeDropbox(), client = new DropboxClient({ accessToken: 'fixture-access', fetcher: dbx.fetcher, wait: async () => {} });
  const data = Buffer.alloc(9 * 1024 * 1024, 'x'), file = { data, size: data.length, contentHash: referenceHash(data) };
  dbx.loseAppend(); dbx.loseFinish();
  await client.upload(file, '/large.eml');
  assert.deepEqual(dbx.files.get('/large.eml').data, data); assert.equal(dbx.uploads(), 1);
  dbx.corrupt();
  await assert.rejects(client.upload(file, '/bad.eml'), { code: 'checksum' });
});

test('Dropbox quota, unsafe paths and missing access return actionable errors without changing local backup success', async () => {
  const f = fixture(), dbx = fakeDropbox();
  try {
    dbx.quota();
    const result = await run(f.data, 'sync', null, { store: f.store, clientId, fetcher: dbx.fetcher });
    assert.equal(result.errorCode, 'quota'); assert.equal(result.connected, true);
    assert.deepEqual(fs.readFileSync(path.join(f.root, f.relative)), f.source);
    assert.equal(drive.readJson(path.join(f.root, 'last-run.json')).success, true);
    f.manifest.folders.inbox.messages[42].file = '../secret.eml'; drive.writeJson(path.join(f.root, 'manifest.json'), f.manifest);
    const unsafe = await run(f.data, 'sync', null, { store: f.store, clientId, fetcher: async () => assert.fail('Do not upload unsafe manifests') });
    assert.equal(unsafe.errorCode, 'files');
    const missingScopes = new DropboxClient({ accessToken: 'fixture', fetcher: async () => json({ error: { '.tag': 'missing_scope' }, error_summary: 'private details' }, 403) });
    await assert.rejects(missingScopes.metadata('/mail.eml'), error => error.code === 'permission' && !error.message.includes('private details'));
  } finally { f.cleanup(); }
});

test('Dropbox automatic sync is opt-in, queues the latest archive, and auth expiry leaves local and Google backups intact', async () => {
  const f = fixture(), dbx = fakeDropbox(), options = { store: f.store, clientId, fetcher: dbx.fetcher, wait: async () => {} };
  try {
    await run(f.data, 'automatic', false, options);
    await syncAfterBackup(f.data, { ...options, fetcher: async () => assert.fail('Opt-in required') });
    await run(f.data, 'automatic', true, options);
    const manual = run(f.data, 'sync', null, options); await syncAfterBackup(f.data, options); await manual;
    assert.equal(publicStatus(f.data, options).skippedFiles, 2);
    await f.store(f.data, 'save', { ...f.credentials(), expiresAt: 0 });
    await syncAfterBackup(f.data, { ...options, fetcher: async () => json({ error: 'invalid_grant', raw: 'private payload' }, 400) });
    const failed = publicStatus(f.data, options);
    assert.equal(failed.errorCode, 'auth'); assert.equal(failed.connected, false); assert.equal(failed.automatic, false);
    assert.equal(drive.readJson(path.join(f.root, 'last-run.json')).success, true);
    assert.equal(drive.readJson(path.join(f.data, 'cloud-drive.json')).connected, true);
  } finally { f.cleanup(); }
});

test('Dropbox status excludes credentials and disconnect deletes only its saved access', async () => {
  const f = fixture();
  try {
    drive.writeJson(path.join(f.data, 'cloud-dropbox.json'), { connected: true, automatic: true, accessToken: 'never show', refreshToken: 'never show', clientId: 'never show' });
    assert.equal(JSON.stringify(publicStatus(f.data, { clientId })).includes('never show'), false);
    const result = await run(f.data, 'disconnect', null, { store: f.store, clientId });
    assert.equal(result.connected, false); assert.equal(result.automatic, false); assert.equal(f.credentials(), null);
    assert.equal(drive.readJson(path.join(f.data, 'cloud-drive.json')).connected, true);
    assert.deepEqual(fs.readFileSync(path.join(f.root, f.relative)), f.source);
    const setup = await run(f.data, 'connect', null, { store: f.store, clientId: 'bad' });
    assert.equal(setup.errorCode, 'setup');
  } finally { f.cleanup(); }
});

test('Dropbox refreshes expired access and retries throttled HTTP calls without exposing provider errors', async () => {
  let calls = 0, refreshed = 0;
  const client = new DropboxClient({ accessToken: 'expired', refresh: async () => { refreshed++; return 'fresh'; }, wait: async () => {}, fetcher: async () => {
    calls++; return calls === 1 ? json({}, 401) : calls === 2 ? json({}, 429) : json({ '.tag': 'file', size: 1 });
  } });
  assert.equal((await client.metadata('/one.eml')).size, 1); assert.equal(refreshed, 1); assert.equal(calls, 3);
  await assert.rejects(tokenRequest({ client_id: clientId }, async () => json({ error: 'invalid_grant', private: 'never show' }, 400)), error => error.code === 'auth' && !error.message.includes('never show'));
});

test('Dropbox DPAPI credentials are encrypted and isolated from the Google credential file', { skip: process.platform !== 'win32' }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-dropbox-dpapi-'));
  try {
    await drive.credentialStore(data, 'save', { clientId: 'fixture-google', refreshToken: 'fixture-google-token' });
    const tokens = { clientId, refreshToken: 'fixture-dropbox-token' };
    await credentialStore(data, 'save', tokens);
    assert.equal(fs.readFileSync(path.join(data, '.private', 'dropbox.dat'), 'utf8').includes(tokens.refreshToken), false);
    assert.deepEqual(await credentialStore(data, 'read'), tokens);
    await credentialStore(data, 'delete');
    assert.equal(await credentialStore(data, 'read'), null);
    assert.equal((await drive.credentialStore(data, 'read')).refreshToken, 'fixture-google-token');
  } finally { fs.rmSync(data, { recursive: true, force: true }); }
});
