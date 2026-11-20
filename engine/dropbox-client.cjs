const crypto = require('node:crypto');
const fs = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');
const messages = require('./dropbox-messages.json');
const SCOPES = ['account_info.read', 'files.metadata.read', 'files.content.write'];
const REDIRECT_URI = 'http://127.0.0.1:53683/oauth/dropbox/callback';
const BLOCK = 4 * 1024 * 1024;
class DropboxError extends Error { constructor(code) { super(messages[code] || messages.failed); this.code = messages[code] ? code : 'failed'; } }
const validAppKey = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
function oauthRequest(clientId, redirectUri = REDIRECT_URI) {
  if (!validAppKey(clientId)) throw new DropboxError('setup');
  const state = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const url = new URL('https://www.dropbox.com/oauth2/authorize');
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', token_access_type: 'offline',
    scope: SCOPES.join(' '), state, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') });
  return { state, verifier, url: url.toString() };
}
async function tokenRequest(values, fetcher = fetch) {
  let response;
  try { response = await fetcher('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: new URLSearchParams(values), signal: AbortSignal.timeout(30000), redirect: 'error' }); }
  catch { throw new DropboxError('network'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) throw new DropboxError(response.status >= 500 ? 'network' : 'auth');
  if (data.scope && !SCOPES.every(scope => data.scope.split(' ').includes(scope))) throw new DropboxError('permission');
  return data;
}
// Dropbox hashes SHA-256 digests of 4 MiB blocks, rather than the file bytes.
function contentHash(file) {
  const overall = crypto.createHash('sha256'), whole = crypto.createHash('sha256');
  const fd = file.source ? fs.openSync(file.source, 'r') : null;
  try {
    for (let offset = 0; offset < file.size; offset += BLOCK) {
      const length = Math.min(BLOCK, file.size - offset);
      const block = Buffer.alloc(length);
      if (fd !== null) { if (fs.readSync(fd, block, 0, length, offset) !== length) throw new DropboxError('files'); }
      else file.data.copy(block, 0, offset, offset + length);
      whole.update(block); overall.update(crypto.createHash('sha256').update(block).digest());
    }
    if (file.sha256 && whole.digest('hex') !== file.sha256) throw new DropboxError('files');
    return overall.digest('hex');
  } finally { if (fd !== null) fs.closeSync(fd); }
}
const headerJson = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
const hasTag = (value, tag) => value && typeof value === 'object' && (value['.tag'] === tag || Object.values(value).some(item => item && typeof item === 'object' && hasTag(item, tag)));
function correctedOffset(error) {
  if (!error || typeof error !== 'object') return null;
  if (error['.tag'] === 'incorrect_offset' && Number.isSafeInteger(error.correct_offset)) return error.correct_offset;
  for (const value of Object.values(error)) if (value && typeof value === 'object') { const result = correctedOffset(value); if (result !== null) return result; }
  return null;
}
class DropboxClient {
  constructor({ accessToken, refresh, fetcher = fetch, wait = sleep }) { Object.assign(this, { accessToken, refresh, fetcher, wait }); }
  async request(route, argument = null, { body, conflict = false } = {}) {
    const content = route.startsWith('files/upload_session/');
    const allowed = ['users/get_current_account', 'files/get_metadata', 'files/create_folder_v2', 'files/upload_session/start', 'files/upload_session/append_v2', 'files/upload_session/finish'];
    if (!allowed.includes(route)) throw new DropboxError('failed');
    for (let attempt = 0; attempt < 4; attempt++) {
      let response;
      const headers = { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': content ? 'application/octet-stream' : 'application/json' };
      if (content) headers['Dropbox-API-Arg'] = headerJson(argument);
      try { response = await this.fetcher(`https://${content ? 'content' : 'api'}.dropboxapi.com/2/${route}`, {
        method: 'POST', headers, body: content ? body || Buffer.alloc(0) : JSON.stringify(argument), signal: AbortSignal.timeout(60000), redirect: 'error',
      }); } catch { if (attempt === 3) throw new DropboxError('network'); await this.wait(500 * 2 ** attempt); continue; }
      const data = await response.json().catch(() => null);
      if (response.ok) return data;
      if (response.status === 401 && attempt === 0 && this.refresh) { this.accessToken = await this.refresh(); continue; }
      if (response.status === 409 && conflict) return { conflict: data?.error || {} };
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const delay = Math.min(30000, Math.max(500 * 2 ** attempt, (Number(response.headers.get('retry-after')) || Number(data?.error?.retry_after) || 0) * 1000));
        await this.wait(delay); continue;
      }
      throw new DropboxError(response.status === 401 ? 'auth' : response.status === 403 || hasTag(data?.error, 'missing_scope') ? 'permission' : response.status === 429 || hasTag(data?.error, 'insufficient_space') ? 'quota' : response.status >= 500 ? 'network' : 'failed');
    }
    throw new DropboxError('auth');
  }
  async metadata(remote) {
    const result = await this.request('files/get_metadata', { path: remote }, { conflict: true });
    if (result?.conflict) { if (hasTag(result.conflict, 'not_found')) return null; throw new DropboxError('failed'); }
    return result;
  }
  async folder(remote) {
    const existing = await this.metadata(remote);
    if (existing) { if (existing['.tag'] !== 'folder') throw new DropboxError('failed'); return; }
    const result = await this.request('files/create_folder_v2', { path: remote, autorename: false }, { conflict: true });
    if (result?.conflict && (await this.metadata(remote))?.['.tag'] !== 'folder') throw new DropboxError('failed');
  }
  async upload(file, remote, progress = () => {}) {
    const existing = await this.metadata(remote);
    if (existing && existing['.tag'] !== 'file') throw new DropboxError('failed');
    if (existing?.content_hash === file.contentHash && existing.size === file.size) { progress(file.size); return { skipped: true }; }
    const started = await this.request('files/upload_session/start', { close: false });
    if (typeof started?.session_id !== 'string') throw new DropboxError('failed');
    let offset = 0, stalled = 0;
    const fd = file.source ? fs.openSync(file.source, 'r') : null;
    const commit = { path: remote, mode: existing ? { '.tag': 'update', update: existing.rev } : { '.tag': 'add' }, autorename: false, mute: true, strict_conflict: true };
    try {
      while (offset < file.size) {
        const length = Math.min(8 * 1024 * 1024, file.size - offset), buffer = Buffer.alloc(length);
        if (fd !== null) { if (fs.readSync(fd, buffer, 0, length, offset) !== length) throw new DropboxError('files'); }
        else file.data.copy(buffer, 0, offset, offset + length);
        const result = await this.request('files/upload_session/append_v2', { cursor: { session_id: started.session_id, offset }, close: false }, { body: buffer, conflict: true });
        if (result?.conflict) {
          const corrected = correctedOffset(result.conflict);
          if (corrected === null || corrected < 0 || corrected > file.size || corrected <= offset && ++stalled > 3) throw new DropboxError('network');
          if (corrected > offset) stalled = 0;
          offset = corrected;
        } else { offset += length; stalled = 0; }
        progress(offset);
      }
      let result;
      try { result = await this.request('files/upload_session/finish', { cursor: { session_id: started.session_id, offset }, commit, content_hash: file.contentHash }, { conflict: true }); }
      catch (error) { if (error.code !== 'network') throw error; }
      if (!result || result.conflict) {
        // A lost finish response may leave an already committed file. Verify
        // it by path/hash rather than creating a second copy or overwriting it.
        const recovered = await this.metadata(remote);
        if (recovered?.content_hash === file.contentHash && recovered.size === file.size) return { skipped: false };
        if (hasTag(result?.conflict, 'insufficient_space')) throw new DropboxError('quota');
        throw new DropboxError('failed');
      }
      if (result.content_hash !== file.contentHash || result.size !== file.size) throw new DropboxError('checksum');
      return { skipped: false };
    } finally { if (fd !== null) fs.closeSync(fd); }
  }
}
module.exports = { DropboxClient, DropboxError, messages, validAppKey, oauthRequest, tokenRequest, contentHash, headerJson, SCOPES, REDIRECT_URI };
