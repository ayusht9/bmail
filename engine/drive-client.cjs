const crypto = require('node:crypto');
const fs = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const messages = require('./drive-messages.json');
class DriveError extends Error {
  constructor(code) { super(messages[code] || messages.failed); this.code = messages[code] ? code : 'failed'; }
}
function validSession(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'www.googleapis.com' && url.pathname.startsWith('/upload/drive/v3/files') && !url.username && !url.password; }
  catch { return false; }
}
function oauthRequest(client, redirectUri) {
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(client?.clientId || '') || typeof client.clientSecret !== 'string' || !client.clientSecret) throw new DriveError('client');
  const state = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', state, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') });
  return { state, verifier, url: url.toString() };
}
async function tokenRequest(values, fetcher = fetch) {
  let response;
  try { response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams(values), signal: AbortSignal.timeout(30000), redirect: 'error' }); }
  catch { throw new DriveError('network'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new DriveError(response.status >= 500 ? 'network' : 'auth');
  if (data.scope && !data.scope.split(' ').includes(SCOPE)) throw new DriveError('permission');
  return data;
}

class DriveClient {
  constructor({ accessToken, refresh, fetcher = fetch, wait = sleep }) { Object.assign(this, { accessToken, refresh, fetcher, wait }); }
  async request(url, options = {}, allowed = [], retry = true) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.googleapis.com') throw new DriveError('failed');
    for (let attempt = 0; attempt < 4; attempt++) {
      let response;
      try { response = await this.fetcher(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${this.accessToken}` }, signal: AbortSignal.timeout(60000), redirect: 'manual' }); }
      catch { if (!retry || attempt === 3) throw new DriveError('network'); await this.wait(500 * 2 ** attempt); continue; }
      if (response.ok || allowed.includes(response.status)) return response;
      if (response.status === 401 && attempt === 0 && this.refresh) { this.accessToken = await this.refresh(); continue; }
      const body = await response.json().catch(() => ({}));
      const reasons = body.error?.errors?.map(item => item.reason) || [];
      const quota = response.status === 429 || reasons.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded', 'storageQuotaExceeded'].includes(reason));
      if ((quota || response.status >= 500) && attempt < 3 && retry) {
        const delay = Math.min(30000, Math.max(500 * 2 ** attempt, (Number(response.headers.get('retry-after')) || 0) * 1000));
        await this.wait(delay); continue;
      }
      throw new DriveError(response.status === 401 ? 'auth' : quota ? 'quota' : response.status === 403 ? 'permission' : response.status >= 500 ? 'network' : 'failed');
    }
    throw new DriveError('auth');
  }
  async find(key) {
    const query = new URLSearchParams({ q: `trashed = false and appProperties has { key='bmailKey' and value='${key}' }`, fields: 'files(id,md5Checksum,size,mimeType)', pageSize: '100' });
    const result = await (await this.request(`${API}/files?${query}`)).json();
    return result.files?.[0] || null;
  }
  async reserve() { return (await (await this.request(`${API}/files/generateIds?count=1&space=drive&type=files`)).json()).ids[0]; }
  async reservedId(key, index, persist) {
    if (index[key]) {
      const response = await this.request(`${API}/files/${encodeURIComponent(index[key])}?fields=id,trashed,appProperties,mimeType,md5Checksum,size`, {}, [404]);
      if (response.status !== 404) {
        const item = await response.json();
        if (item.trashed) delete index[key];
        else if (item.appProperties?.bmailKey !== key) throw new DriveError('failed');
      }
    }
    const id = index[key] ||= await this.reserve(); persist(); return id;
  }
  async folder(name, parent, key, index, persist) {
    const existing = await this.find(key);
    if (existing) {
      if (existing.mimeType !== 'application/vnd.google-apps.folder') throw new DriveError('failed');
      return existing.id;
    }
    const id = await this.reservedId(key, index, persist);
    const response = await this.request(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}), appProperties: { bmailKey: key } }) }, [409]);
    if (response.status === 409) { const found = await this.find(key); if (!found || found.id !== id) throw new DriveError('failed'); }
    return id;
  }
  async upload(file, parent, key, index, persist, progress = () => {}) {
    const existing = await this.find(key);
    if (existing?.md5Checksum === file.md5 && Number(existing.size) === file.size) { progress(file.size); return { id: existing.id, skipped: true }; }
    const id = existing?.id || await this.reservedId(key, index, persist);
    const query = new URLSearchParams({ uploadType: 'resumable', fields: 'id,md5Checksum,size' });
    const response = await this.request(`${UPLOAD}${existing ? '/' + encodeURIComponent(id) : ''}?${query}`, {
      method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(file.size) },
      body: JSON.stringify({ ...(existing ? {} : { id, parents: [parent] }), name: file.name, appProperties: { bmailKey: key } }),
    }, [409]);
    if (response.status === 409) {
      const found = await this.find(key);
      if (found?.md5Checksum === file.md5 && Number(found.size) === file.size) return { id: found.id, skipped: true };
      throw new DriveError('failed');
    }
    const session = response.headers.get('location');
    if (!validSession(session)) throw new DriveError('failed');
    let offset = 0, stalled = 0, completed;
    const fd = file.source ? fs.openSync(file.source, 'r') : null;
    try {
      while (offset < file.size || file.size === 0 && !completed) {
        const length = Math.min(8 * 1024 * 1024, file.size - offset);
        const buffer = Buffer.alloc(length);
        if (fd !== null) { if (fs.readSync(fd, buffer, 0, length, offset) !== length) throw new DriveError('files'); }
        else file.data.copy(buffer, 0, offset, offset + length);
        let chunk;
        try {
          chunk = await this.request(session, { method: 'PUT', headers: { 'Content-Length': String(length), 'Content-Range': file.size ? `bytes ${offset}-${offset + length - 1}/${file.size}` : 'bytes */0' }, body: buffer }, [308, 404, 410, 416], false);
          if (chunk.status === 416) chunk = await this.request(session, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${file.size}` } }, [308, 404, 410]);
        } catch (error) {
          if (error.code !== 'network') throw error;
          chunk = await this.request(session, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${file.size}` } }, [308, 404, 410]);
        }
        if ([404, 410].includes(chunk.status)) throw new DriveError('network');
        if (chunk.status === 308) {
          const range = /^bytes=0-(\d+)$/.exec(chunk.headers.get('range') || '');
          const next = range ? Number(range[1]) + 1 : 0;
          if (next < 0 || next > file.size || next <= offset && ++stalled > 3) throw new DriveError('network');
          if (next > offset) stalled = 0;
          offset = next; progress(offset);
        } else { completed = await chunk.json(); offset = file.size; progress(offset); break; }
      }
    } finally { if (fd !== null) fs.closeSync(fd); }
    if (!completed || completed.md5Checksum !== file.md5 || Number(completed.size) !== file.size) throw new DriveError('checksum');
    return { id: completed.id || id, skipped: false };
  }
}
module.exports = { DriveClient, DriveError, messages, oauthRequest, tokenRequest, validSession, SCOPE };
