export const ACTIVE_POLL_MS = 2000;
export const IDLE_POLL_MS = 10000;

export function pollDelay({ hidden, busy, controlBusy, backupRunning }) {
  if (hidden) return null;
  return backupRunning || busy || controlBusy ? ACTIVE_POLL_MS : IDLE_POLL_MS;
}

export function createDashboardPoller({ refresh, state, schedule = setTimeout, cancel = clearTimeout }) {
  let timer = null;
  let stopped = true;
  const clear = () => { if (timer !== null) cancel(timer); timer = null; };
  const reschedule = () => {
    clear();
    if (stopped) return;
    const delay = pollDelay(state());
    if (delay !== null) timer = schedule(tick, delay);
  };
  async function tick() {
    clear();
    if (stopped) return;
    const current = state();
    try {
      if (!current.hidden && !current.busy && !current.controlBusy) await refresh();
    } catch { /* A failed refresh must not stop later polls. */ }
    finally { reschedule(); }
  }
  return {
    start() { stopped = false; reschedule(); },
    reschedule,
    wake() { if (!stopped) return tick(); },
    stop() { stopped = true; clear(); },
  };
}
