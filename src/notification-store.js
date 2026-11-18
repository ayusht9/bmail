const levels = ['success', 'info', 'error'];

export function createNotificationStore({ read = () => [], write = () => {}, now = Date.now } = {}) {
  let items;
  try {
    const saved = read();
    items = Array.isArray(saved) ? saved.filter(item => item && typeof item.id === 'string' && typeof item.account === 'string'
      && typeof item.message === 'string' && levels.includes(item.level) && Number.isFinite(Date.parse(item.createdAt))) : [];
  } catch { items = []; }
  let serial = 0;
  function persist() {
    const counts = new Map();
    items = items.filter(item => {
      const count = (counts.get(item.account) || 0) + 1;
      counts.set(item.account, count);
      return count <= 100;
    }).slice(0, 500);
    try { write(items); } catch { /* Notifications remain usable without storage. */ }
  }
  persist();
  return {
    add(account, message, { level = 'info', key } = {}) {
      if (key && items.some(item => item.account === account && item.key === key)) return null;
      const time = now();
      let id;
      do { id = `${time}-${++serial}`; } while (items.some(item => item.id === id));
      const item = { id, account, message: String(message).slice(0, 8000), level: levels.includes(level) ? level : 'info', createdAt: new Date(time).toISOString(), read: false, key };
      items.unshift(item);
      persist();
      return { ...item };
    },
    list(account) { return items.filter(item => item.account === account).map(item => ({ ...item })); },
    unread(account) { return items.filter(item => item.account === account && !item.read).length; },
    markRead(account, id) { items.forEach(item => { if (item.account === account && (!id || item.id === id)) item.read = true; }); persist(); },
    clear(account) { items = items.filter(item => item.account !== account); persist(); },
  };
}
