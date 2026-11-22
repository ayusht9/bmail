import { userMessage } from './errors.js';
const levels = ['success', 'info', 'error'];

export function createNotificationStore({ read = () => [], write = () => {}, readState = () => ({}), writeState = () => {}, now = Date.now } = {}) {
  let items;
  try {
    const saved = read();
    items = Array.isArray(saved) ? saved.filter(item => item && typeof item.id === 'string' && typeof item.account === 'string'
      && typeof item.message === 'string' && levels.includes(item.level) && Number.isFinite(Date.parse(item.createdAt))) : [];
    items = items.map(item => item.level === 'error' ? { ...item, message: userMessage(item.message) } : item);
  } catch { items = []; }
  let serial = 0;
  let savedState;
  try { savedState = readState() || {}; } catch { savedState = {}; }
  const seen = new Set(Array.isArray(savedState.seen) ? savedState.seen.filter(key => typeof key === 'string').slice(-1000) : []);
  const current = new Map(Array.isArray(savedState.current) ? savedState.current.filter(entry => Array.isArray(entry) && entry.length === 2 && entry.every(value => typeof value === 'string')) : []);
  const eventKey = (account, key) => JSON.stringify([account, key]);
  for (const item of items) if (item.key) seen.add(eventKey(item.account, item.key));
  function persist() {
    const counts = new Map();
    items = items.filter(item => {
      const count = (counts.get(item.account) || 0) + 1;
      counts.set(item.account, count);
      return count <= 100;
    }).slice(0, 500);
    try { write(items); } catch { /* Notifications remain usable without storage. */ }
    while (seen.size > 1000) seen.delete(seen.values().next().value);
    try { writeState({ seen: [...seen], current: [...current].slice(-100) }); } catch {}
  }
  persist();
  return {
    add(account, message, { level = 'info', key } = {}) {
      if (key && seen.has(eventKey(account, key))) return null;
      if (key) seen.add(eventKey(account, key));
      const time = now();
      let id;
      do { id = `${time}-${++serial}`; } while (items.some(item => item.id === id));
      const item = { id, account, message: (level === 'error' ? userMessage(message) : String(message)).slice(0, 8000), level: levels.includes(level) ? level : 'info', createdAt: new Date(time).toISOString(), read: false, key };
      items.unshift(item);
      persist();
      return { ...item };
    },
    list(account) { return items.filter(item => item.account === account).map(item => ({ ...item })); },
    reconcile(account, message, { key, prefix = key, level = 'info' } = {}) {
      const identity = eventKey(account, key);
      const signature = message || '';
      const existing = items.find(item => item.account === account && item.key?.startsWith(prefix) && item.message === message);
      const changed = current.has(identity) ? current.get(identity) !== signature : !existing;
      current.set(identity, signature);
      if (existing) existing.key = key;
      items = items.filter(item => item.account !== account || !item.key?.startsWith(prefix) || item === existing);
      if (message && changed) {
        items = items.filter(item => item !== existing);
        const time = now();
        let id;
        do { id = `${time}-${++serial}`; } while (items.some(item => item.id === id));
        items.unshift({ id, account, key, level, message: String(message).slice(0, 8000), createdAt: new Date(time).toISOString(), read: false });
      }
      persist();
    },
    unread(account) { return items.filter(item => item.account === account && !item.read).length; },
    markRead(account, id) { items.forEach(item => { if (item.account === account && (!id || item.id === id)) item.read = true; }); persist(); },
    clear(account) { items = items.filter(item => item.account !== account); persist(); },
  };
}
