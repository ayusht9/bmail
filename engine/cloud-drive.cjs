const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { DriveClient, DriveError, messages, oauthRequest, tokenRequest } = require('./drive-client.cjs');
const { dataDirectory } = require('./paths.cjs');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; } }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.pending`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2)); fs.renameSync(temporary, file);
}
function publicStatus(data) {
  const status = readJson(path.join(data, 'cloud-drive.json'), {});
  const result = {};
  for (const key of ['configured', 'connected', 'automatic', 'stage', 'driveAccount', 'folderName', 'folderId', 'lastSyncedAt', 'completedFiles', 'totalFiles', 'uploadedBytes', 'totalBytes', 'skippedFiles', 'errorCode', 'updatedAt']) {
    if (['string', 'number', 'boolean'].includes(typeof status[key])) result[key] = status[key];
  }
  if (['connecting', 'uploading'].includes(result.stage) && !alive(status.pid)) { result.stage = 'interrupted'; result.errorCode = 'failed'; }
  return result;
}
function alive(pid) { try { if (!Number.isSafeInteger(pid) || pid < 1) return false; process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } }
function acquire(data, provider = 'drive') {
  const directory = path.join(data, '.private'); fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${provider}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const fd = fs.openSync(file, 'wx'); fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd); return () => { try { fs.unlinkSync(file); } catch {} }; }
    catch (error) {
      if (error.code !== 'EEXIST') throw new DriveError('failed');
      const pid = Number(fs.readFileSync(file, 'utf8'));
      if (alive(pid) || !pid) throw new DriveError('busy');
      fs.unlinkSync(file);
    }
  }
  throw new DriveError('busy');
}
function credentialStore(data, action, value, provider = 'google-drive') {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'Drive-Credentials.ps1')],
      { windowsHide: true, env: { ...process.env, MAIL_VAULT_DATA_DIR: data }, stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('error', () => reject(new DriveError('credentials')));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      if (code !== 0) { reject(new DriveError(code === 2 ? 'client' : 'credentials')); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''))); } catch { reject(new DriveError('credentials')); }
    });
    child.stdin.end(JSON.stringify({ action, value, provider }));
  });
}
function openBrowser(url) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$url = [Console]::In.ReadToEnd(); Start-Process -FilePath $url'], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => reject(new DriveError('auth')));
    child.stdin.on('error', () => {}); child.stdin.end(url);
    child.on('close', code => code === 0 ? resolve() : reject(new DriveError('auth')));
  });
}
async function authorize(client, { browser = openBrowser, fetcher = fetch, timeout = 180000 } = {}) {
  oauthRequest(client, 'http://127.0.0.1/');
  let finish, rejectCode;
  const codePromise = new Promise((resolve, reject) => { finish = resolve; rejectCode = reject; });
  // Attach a rejection handler before launching a browser; timeout may fire first.
  codePromise.catch(() => {});
  let auth, redirectUri;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, redirectUri);
    if (request.method !== 'GET' || url.pathname !== '/oauth/callback') { response.writeHead(404).end(); return; }
    if (url.searchParams.get('state') !== auth.state) { response.writeHead(400).end('Invalid sign-in response.'); return; }
    const code = url.searchParams.get('code');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'", 'Connection': 'close' });
    response.end('<!doctype html><title>Bmail</title><h1>Return to Bmail</h1><p>You can close this browser tab.</p>');
    if (!code || url.searchParams.has('error')) rejectCode(new DriveError('auth')); else finish(code);
  });
  await new Promise((resolve, reject) => { server.once('error', () => reject(new DriveError('auth'))); server.listen(0, '127.0.0.1', resolve); });
  redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
  auth = oauthRequest(client, redirectUri);
  const timer = setTimeout(() => rejectCode(new DriveError('timeout')), timeout);
  try {
    await browser(auth.url);
    const code = await codePromise;
    const tokens = await tokenRequest({ client_id: client.clientId, client_secret: client.clientSecret, code, redirect_uri: redirectUri, code_verifier: auth.verifier, grant_type: 'authorization_code' }, fetcher);
    if (!tokens.refresh_token) throw new DriveError('auth');
    return { ...client, refreshToken: tokens.refresh_token, accessToken: tokens.access_token, expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 };
  } finally { clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
async function describeFile(root, relative, record) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..') || path.extname(relative).toLowerCase() !== '.eml') throw new DriveError('files');
  let source, stat;
  try { source = fs.realpathSync(path.resolve(root, relative)); stat = fs.statSync(source); } catch { throw new DriveError('files'); }
  const within = path.relative(root, source);
  if (!within || within.startsWith('..' + path.sep) || path.isAbsolute(within) || !stat.isFile() || record.bytes !== stat.size || !/^[a-f0-9]{64}$/i.test(record.sha256 || '')) throw new DriveError('files');
  const sha = crypto.createHash('sha256'), md5 = crypto.createHash('md5');
  try { for await (const chunk of fs.createReadStream(source)) { sha.update(chunk); md5.update(chunk); } } catch { throw new DriveError('files'); }
  if (sha.digest('hex') !== record.sha256) throw new DriveError('files');
  return { relative: relative.replace(/\\/g, '/'), name: path.posix.basename(relative.replace(/\\/g, '/')), source, size: stat.size, sha256: record.sha256, md5: md5.digest('hex') };
}
async function archiveFiles(root, config) {
  let base; try { base = fs.realpathSync(root); } catch { throw new DriveError('archive'); }
  const manifest = readJson(path.join(base, 'manifest.json'));
  if (!manifest || manifest.user !== config.user || manifest.host !== config.host || manifest.version !== 1 || !manifest.folders || typeof manifest.folders !== 'object') throw new DriveError('archive');
  const files = [], seen = new Set();
  // Validate every retained message before publishing any snapshot to Drive.
  for (const folder of Object.values(manifest.folders)) {
    if (!folder || typeof folder.messages !== 'object' || !folder.messages) throw new DriveError('files');
    for (const record of Object.values(folder.messages)) {
    if (!record || typeof record !== 'object') throw new DriveError('files');
    if (record.complete === false) throw new DriveError('files');
    if (seen.has(record.file)) continue;
    seen.add(record.file); files.push(await describeFile(base, record.file, record));
    }
  }
  if (!files.length) throw new DriveError('archive');
  const data = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  files.push({ relative: 'manifest.json', name: 'manifest.json', data, size: data.length, md5: crypto.createHash('md5').update(data).digest('hex') });
  return files;
}
async function syncArchive(data, config, credentials, update, { store = credentialStore, fetcher = fetch } = {}) {
  const root = path.resolve(data, config.backupDirectory || 'backups');
  update({ stage: 'uploading', errorCode: '', completedFiles: 0, totalFiles: 0, uploadedBytes: 0, totalBytes: 0, skippedFiles: 0 });
  const files = await archiveFiles(root, config);
  const refresh = async () => {
    const tokens = await tokenRequest({ client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: credentials.refreshToken, grant_type: 'refresh_token' }, fetcher);
    Object.assign(credentials, { accessToken: tokens.access_token, expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 });
    if (tokens.refresh_token) credentials.refreshToken = tokens.refresh_token;
    await store(data, 'save', credentials);
    return credentials.accessToken;
  };
  if (!credentials.accessToken || credentials.expiresAt < Date.now() + 60000) await refresh();
  const client = new DriveClient({ accessToken: credentials.accessToken, refresh, fetcher });
  const indexPath = path.join(data, '.private', 'drive-index.json');
  const index = readJson(indexPath, {});
  const persist = () => writeJson(indexPath, index);
  const namespace = hash(JSON.stringify([config.user, config.host]));
  const key = relative => hash(namespace + '/' + relative);
  const folderName = `Bmail - ${config.user}`;
  const folderId = await client.folder(folderName, null, key(''), index, persist);
  const folders = new Map([['', folderId]]);
  async function folderFor(relative) {
    if (folders.has(relative)) return folders.get(relative);
    const parent = path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative);
    const id = await client.folder(path.posix.basename(relative), await folderFor(parent), key('folder/' + relative), index, persist);
    folders.set(relative, id); return id;
  }
  let completedFiles = 0, uploadedBytes = 0, skippedFiles = 0;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  update({ folderName, folderId, totalFiles: files.length, totalBytes });
  for (const file of files) {
    const parent = path.posix.dirname(file.relative) === '.' ? '' : path.posix.dirname(file.relative);
    const result = await client.upload(file, await folderFor(parent), key('file/' + file.relative), index, persist, bytes => update({ uploadedBytes: uploadedBytes + bytes }));
    uploadedBytes += file.size; completedFiles++; if (result.skipped) skippedFiles++;
    update({ completedFiles, uploadedBytes, skippedFiles });
  }
  update({ stage: 'ready', errorCode: '', lastSyncedAt: new Date().toISOString(), completedFiles, uploadedBytes, skippedFiles });
}
async function run(data, action, value, options = {}) {
  if (action === 'status') return publicStatus(data);
  const release = acquire(data);
  const stateFile = path.join(data, 'cloud-drive.json');
  let state = readJson(stateFile, {});
  const update = patch => { state = { ...state, ...patch, pid: process.pid, updatedAt: new Date().toISOString() }; writeJson(stateFile, state); };
  const store = options.store || credentialStore;
  try {
    if (action === 'setup') {
      if (state.connected) throw new DriveError('busy');
      const client = await store(data, 'import');
      if (!client) return publicStatus(data);
      oauthRequest(client, 'http://127.0.0.1/');
      await store(data, 'save', client);
      update({ configured: true, connected: false, automatic: false, stage: 'disconnected', errorCode: '' });
    } else if (action === 'connect') {
      const credentials = await store(data, 'read');
      if (!credentials?.clientId) throw new DriveError('setup');
      update({ stage: 'connecting', errorCode: '' });
      const connected = await authorize(credentials, options);
      const client = new DriveClient({ accessToken: connected.accessToken, fetcher: options.fetcher });
      const about = await (await client.request('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)')).json();
      // A different Google account must not reuse reserved file IDs.
      try { fs.unlinkSync(path.join(data, '.private', 'drive-index.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await store(data, 'save', connected);
      update({ configured: true, connected: true, driveAccount: about.user?.emailAddress || '', stage: 'ready', errorCode: '', folderId: '', folderName: '', lastSyncedAt: '' });
    } else if (action === 'automatic') {
      if (typeof value !== 'boolean' || value && !state.connected) throw new DriveError('auth');
      update({ automatic: value });
    } else if (action === 'disconnect') {
      const credentials = await store(data, 'read');
      // Remove this mailbox's saved access. Revoking Google's shared app grant
      // here would also disconnect other mailboxes using the same Google app.
      if (credentials) await store(data, 'save', { clientId: credentials.clientId, clientSecret: credentials.clientSecret });
      update({ connected: false, automatic: false, stage: 'disconnected', driveAccount: '', errorCode: '', folderId: '', folderName: '' });
    } else if (action === 'sync') {
      const config = readJson(path.join(data, 'backup-config.json'));
      const credentials = await store(data, 'read');
      if (!state.connected || !credentials?.refreshToken) throw new DriveError('auth');
      if (!config?.user) throw new DriveError('archive');
      await syncArchive(data, config, credentials, update, { ...options, store });
    } else throw new DriveError('failed');
    return publicStatus(data);
  } catch (error) {
    const code = error instanceof DriveError ? error.code : 'failed';
    update({ stage: 'error', errorCode: code, ...(['auth', 'credentials'].includes(code) ? { connected: false, automatic: false } : {}) });
    return publicStatus(data);
  } finally {
    release();
    const queued = path.join(data, '.private', 'drive-resync');
    if (action === 'sync' && fs.existsSync(queued)) {
      fs.unlinkSync(queued);
      const latest = publicStatus(data);
      if (latest.connected && latest.automatic) await run(data, 'sync', null, options);
    }
  }
}
async function syncAfterBackup(data, options = {}) {
  const status = publicStatus(data);
  if (!status.connected || !status.automatic) return;
  try { await run(data, 'sync', null, options); }
  catch (error) {
    // If a manual upload already owns the lock, it will run again with the
    // latest local manifest before finishing. Do not lose newly saved mail.
    if (error.code === 'busy') { try { writeJson(path.join(data, '.private', 'drive-resync'), { queued: true }); } catch {} }
  }
}
if (require.main === module) (async () => {
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input || '{}');
  if (!['status', 'setup', 'connect', 'automatic', 'sync', 'disconnect'].includes(request.action)) throw new DriveError('failed');
  process.stdout.write(JSON.stringify(await run(dataDirectory(), request.action, request.value)));
})().catch(error => { const code = error instanceof DriveError ? error.code : 'failed'; process.stdout.write(JSON.stringify({ ...publicStatus(dataDirectory()), ...(code === 'busy' ? {} : { stage: 'error' }), errorCode: code })); process.exitCode = 1; });
module.exports = { run, publicStatus, authorize, archiveFiles, describeFile, syncArchive, syncAfterBackup, credentialStore, readJson, writeJson, messages, acquire, alive, openBrowser };
