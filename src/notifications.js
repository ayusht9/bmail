export function normalizeNewMailCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.min(0xffffffff, Math.max(0, Math.floor(count))) : 0;
}

export function totalNewMail(indicators) {
  return normalizeNewMailCount([...indicators.values()].reduce((sum, count) => sum + normalizeNewMailCount(count), 0));
}

export function newMailBadge(count, escape, folder = '') {
  count = normalizeNewMailCount(count);
  if (!count) return '';
  const label = `${count} new email${count === 1 ? '' : 's'}${folder ? ` in ${folder}` : ''} since the previous mailbox check`;
  return `<span class="new-mail-badge" role="img" aria-label="${escape(label)}" title="${escape(label)}">${count}</span>`;
}

// Serialize native updates, coalesce renders, and retry failures on the next refresh.
export function createBadgeSync(invoke) {
  let desired;
  let sent = '';
  let running;
  let attempted;
  async function flush() {
    while (desired && desired.key !== sent) {
      const target = desired;
      attempted = target;
      try {
        await invoke('set_mail_badge', { account: target.account, count: target.count });
        sent = target.key;
      } catch {
        if (desired === target) return;
      }
    }
  }
  function start() {
    running = flush().finally(() => {
      running = null;
      if (desired.key !== sent && desired !== attempted) start();
    });
  }
  return (account, count) => {
    count = normalizeNewMailCount(count);
    desired = { account, count, key: JSON.stringify([account, count]) };
    if (!running) start();
    return running;
  };
}
