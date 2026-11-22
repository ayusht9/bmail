const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { dataDirectory, backupEnabled } = require('./paths.cjs');
const { readJson, writeJson, acquire, alive, archiveFiles, openBrowser, credentialStore: windowsStore } = require('./cloud-drive.cjs');
const { DropboxClient, DropboxError, validAppKey, oauthRequest, tokenRequest, contentHash, REDIRECT_URI } = require('./dropbox-client.cjs');

const configuredKey = options => options.clientId || process.env.BMAIL_DROPBOX_APP_KEY || '';
function publicStatus(data, options = {}) {
  const state = readJson(path.join(data, 'cloud-dropbox.json'), {}), result = {};
  for (const key of ['connected', 'automatic', 'stage', 'dropboxAccount', 'folderName', 'lastSyncedAt', 'completedFiles', 'totalFiles', 'uploadedBytes', 'totalBytes', 'skippedFiles', 'errorCode', 'updatedAt']) {
    if (['string', 'number', 'boolean'].includes(typeof state[key])) result[key] = state[key];
  }
  result.configured = validAppKey(configuredKey(options)) || state.configured === true;
  if (['connecting', 'uploading'].includes(result.stage) && !alive(state.pid)) { result.stage = 'interrupted'; result.errorCode = 'failed'; }
  return result;
}
async function credentialStore(data, action, value) {
  try { return await windowsStore(data, action, value, 'dropbox'); }
  catch { throw new DropboxError('credentials'); }
}
async function authorize(clientId, { browser = openBrowser, fetcher = fetch, timeout = 180000, port = 53683 } = {}) {
  // Production always uses the registered fixed loopback URI; ephemeral ports
  // are injected only by the local OAuth tests.
  oauthRequest(clientId);
  let finish, fail, auth, redirectUri;
  const result = new Promise((resolve, reject) => { finish = resolve; fail = reject; }); result.catch(() => {});
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, redirectUri);
    if (request.method !== 'GET' || url.pathname !== '/oauth/dropbox/callback') { response.writeHead(404).end(); return; }
    if (url.searchParams.get('state') !== auth.state) { response.writeHead(400).end('Invalid sign-in response.'); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'", Connection: 'close' });
    response.end('<!doctype html><title>Bmail</title><h1>Return to Bmail</h1><p>You can close this browser tab.</p>');
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.has('error')) fail(new DropboxError('auth')); else finish(code);
  });
  await new Promise((resolve, reject) => { server.once('error', () => reject(new DropboxError('port'))); server.listen(port, '127.0.0.1', resolve); });
  redirectUri = `http://127.0.0.1:${server.address().port}/oauth/dropbox/callback`;
  auth = oauthRequest(clientId, redirectUri);
  const timer = setTimeout(() => fail(new DropboxError('timeout')), timeout);
  try {
    try { await browser(auth.url); } catch { throw new DropboxError('auth'); }
    const tokens = await tokenRequest({ grant_type: 'authorization_code', client_id: clientId, code: await result, redirect_uri: redirectUri, code_verifier: auth.verifier }, fetcher);
    if (!tokens.refresh_token) throw new DropboxError('auth');
    return { clientId, refreshToken: tokens.refresh_token, accessToken: tokens.access_token, expiresAt: Date.now() + (Number(tokens.expires_in) || 14400) * 1000 };
  } finally { clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
async function syncArchive(data, config, credentials, update, { store = credentialStore, fetcher = fetch, wait } = {}) {
  update({ stage: 'uploading', errorCode: '', completedFiles: 0, totalFiles: 0, uploadedBytes: 0, totalBytes: 0, skippedFiles: 0 });
  let files;
  try { files = await archiveFiles(path.resolve(data, config.backupDirectory || 'backups'), config); }
  catch (error) { throw new DropboxError(error.code); }
  // Recheck SHA-256 while calculating Dropbox's block hash, so a file changed
  // since manifest validation cannot be published with an outdated manifest.
  for (const file of files) file.contentHash = contentHash(file);
  const refresh = async () => {
    const token = await tokenRequest({ grant_type: 'refresh_token', client_id: credentials.clientId, refresh_token: credentials.refreshToken }, fetcher);
    Object.assign(credentials, { accessToken: token.access_token, expiresAt: Date.now() + (Number(token.expires_in) || 14400) * 1000 });
    if (token.refresh_token) credentials.refreshToken = token.refresh_token;
    await store(data, 'save', credentials); return credentials.accessToken;
  };
  if (!credentials.accessToken || credentials.expiresAt < Date.now() + 60000) await refresh();
  const client = new DropboxClient({ accessToken: credentials.accessToken, refresh, fetcher, wait });
  const namespace = crypto.createHash('sha256').update(JSON.stringify([config.user, config.host])).digest('hex').slice(0, 12);
  const name = String(config.user).replace(/[<>:"|?*\x00-\x1f/\\]/g, '_').slice(0, 150);
  const root = `/Bmail - ${name}--${namespace}`;
  const folders = new Set();
  async function ensureFolder(remote) {
    if (folders.has(remote)) return;
    const parent = path.posix.dirname(remote);
    if (parent !== '/') await ensureFolder(parent);
    await client.folder(remote); folders.add(remote);
  }
  await ensureFolder(root);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  update({ folderName: root, totalFiles: files.length, totalBytes });
  let uploadedBytes = 0, completedFiles = 0, skippedFiles = 0;
  // archiveFiles supplies the manifest last, after all referenced emails.
  for (const file of files) {
    if (!backupEnabled(data, 'cloud')) { update({ stage: 'ready', errorCode: '' }); return; }
    const destination = root + '/' + file.relative;
    await ensureFolder(path.posix.dirname(destination));
    const result = await client.upload(file, destination, bytes => update({ uploadedBytes: uploadedBytes + bytes }));
    uploadedBytes += file.size; completedFiles++; if (result.skipped) skippedFiles++;
    update({ uploadedBytes, completedFiles, skippedFiles });
  }
  update({ stage: 'ready', errorCode: '', lastSyncedAt: new Date().toISOString() });
}
async function run(data, action, value, options = {}) {
  if (action === 'sync' && !backupEnabled(data, 'cloud')) return publicStatus(data);
  if (action === 'status') return publicStatus(data, options);
  let release;
  try { release = acquire(data, 'dropbox'); } catch (error) { throw new DropboxError(error.code); }
  let state = readJson(path.join(data, 'cloud-dropbox.json'), {});
  const update = patch => { state = { ...state, ...patch, pid: process.pid, updatedAt: new Date().toISOString() }; writeJson(path.join(data, 'cloud-dropbox.json'), state); };
  const store = options.store || credentialStore;
  try {
    if (action === 'connect') {
      const clientId = configuredKey(options);
      if (!validAppKey(clientId)) throw new DropboxError('setup');
      update({ stage: 'connecting', errorCode: '' });
      const credentials = await authorize(clientId, options);
      const client = new DropboxClient({ accessToken: credentials.accessToken, fetcher: options.fetcher, wait: options.wait });
      const account = await client.request('users/get_current_account');
      await store(data, 'save', credentials);
      update({ configured: true, connected: true, automatic: false, stage: 'ready', dropboxAccount: account.email || '', folderName: '', lastSyncedAt: '', errorCode: '' });
    } else if (action === 'sync') {
      const credentials = await store(data, 'read');
      if (!state.connected || !credentials?.refreshToken || !validAppKey(credentials.clientId)) throw new DropboxError('auth');
      const config = readJson(path.join(data, 'backup-config.json'));
      if (!config?.user) throw new DropboxError('archive');
      await syncArchive(data, config, credentials, update, { ...options, store });
    } else if (action === 'automatic') {
      if (typeof value !== 'boolean' || value && !state.connected) throw new DropboxError('auth');
      update({ automatic: value });
    } else if (action === 'disconnect') {
      // Clear only this mailbox's tokens. Users can revoke the entire Bmail app
      // grant in Dropbox settings without unexpectedly disconnecting siblings.
      await store(data, 'delete');
      update({ connected: false, automatic: false, stage: 'disconnected', dropboxAccount: '', folderName: '', errorCode: '' });
    } else throw new DropboxError('failed');
    return publicStatus(data, options);
  } catch (error) {
    const code = error instanceof DropboxError ? error.code : 'failed';
    update({ stage: 'error', errorCode: code, ...(['auth', 'credentials'].includes(code) ? { connected: false, automatic: false } : {}) });
    return publicStatus(data, options);
  } finally {
    release();
    const queued = path.join(data, '.private', 'dropbox-resync');
    if (action === 'sync' && fs.existsSync(queued)) {
      fs.unlinkSync(queued);
      const latest = publicStatus(data, options);
      if (latest.connected && latest.automatic) await run(data, 'sync', null, options);
    }
  }
}
async function syncAfterBackup(data, options = {}) {
  const status = publicStatus(data, options);
  if (!status.connected || !status.automatic) return;
  try { await run(data, 'sync', null, options); }
  catch (error) { if (error.code === 'busy') { try { writeJson(path.join(data, '.private', 'dropbox-resync'), { queued: true }); } catch {} } }
}
if (require.main === module) (async () => {
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input || '{}');
  if (!['status', 'connect', 'automatic', 'sync', 'disconnect'].includes(request.action)) throw new DropboxError('failed');
  process.stdout.write(JSON.stringify(await run(dataDirectory(), request.action, request.value)));
})().catch(error => {
  const code = error instanceof DropboxError ? error.code : 'failed';
  process.stdout.write(JSON.stringify({ ...publicStatus(dataDirectory()), ...(code === 'busy' ? {} : { stage: 'error' }), errorCode: code })); process.exitCode = 1;
});
module.exports = { publicStatus, credentialStore, authorize, run, syncArchive, syncAfterBackup, REDIRECT_URI };
