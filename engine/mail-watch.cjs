// One read-only INBOX IDLE connection; periodic checks cover other folders and
// recover missed notifications. A session is bounded so OAuth tokens get renewed.
async function watchMail(client, check, { duration = 10 * 60 * 1000, interval = 60000, parentAlive = () => true } = {}) {
  let stopped = false;
  let timer;
  let idling = false;
  const wake = () => { if (idling) { idling = false; client.noop().catch(stop); } };
  client.on('exists', wake);
  client.on('expunge', wake);
  const deadline = Date.now() + duration;
  const stop = () => { stopped = true; client.close(); };
  client.on('close', () => { stopped = true; });
  const lifetime = setInterval(() => { if (!parentAlive() || Date.now() >= deadline) stop(); }, 1000);
  try {
    await client.connect();
    while (!stopped && Date.now() < deadline) {
      await check();
      if (stopped) break;
      await client.mailboxOpen('INBOX', { readOnly: true });
      if (client.capabilities.has('IDLE')) {
        // Any server event ends IDLE; NOOP also wakes it for catch-up checks.
        idling = true;
        timer = setTimeout(wake, interval);
        try { await client.idle(); } finally { idling = false; clearTimeout(timer); }
      } else {
        await new Promise(resolve => { timer = setTimeout(resolve, interval); });
      }
    }
  } finally { clearInterval(lifetime); clearTimeout(timer); client.close(); }
}
module.exports = { watchMail };
