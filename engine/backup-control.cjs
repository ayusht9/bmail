const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');

class RunInterrupted extends Error {
  constructor(outcome) { super(outcome === 'stopped' ? 'Backup stopped; completed mail is retained.' : 'Backup cancelled; completed mail is retained.'); this.outcome = outcome; }
}
function readControl(root, runId, readJson) {
  const control = readJson(path.join(root, 'control.json'), null);
  return control?.runId === runId ? control.command : null;
}
function createControl(root, client, progress, readJson, stopRequested = () => false) {
  let inMessage = false;
  let closed = false;
  let terminal = null;
  const command = () => {
    const requested = stopRequested() ? 'stop' : readControl(root, progress.context.runId, readJson);
    if (requested === 'cancel') terminal = 'cancel';
    else if (requested === 'stop' && !terminal) terminal = 'stop';
    return terminal || requested;
  };
  function poll() {
    const requested = command();
    if (!closed && (requested === 'cancel' || requested === 'stop' && !inMessage)) {
      closed = true;
      client.close();
    }
  }
  const timer = setInterval(poll, 250);
  timer.unref();
  async function checkpoint(safeToStop = true) {
    let requested = command();
    if (requested === 'cancel') throw new RunInterrupted('cancelled');
    if (requested === 'stop') {
      progress.publish({ state: 'stopping', phase: 'stopping' }, true);
      if (safeToStop) throw new RunInterrupted('stopped');
      return;
    }
    if (requested !== 'pause') return;
    const previousPhase = progress.state.phase;
    const pausedAt = Date.now();
    progress.context.pauseStartedAt = pausedAt;
    let lastNoop = Date.now();
    let connectionLost = false;
    progress.publish({ state: 'paused', phase: 'paused' }, true);
    while ((requested = command()) === 'pause') {
      if (Date.now() - lastNoop >= 30000 && client.noop) {
        lastNoop = Date.now();
        try { await client.noop(); } catch { connectionLost = true; }
      }
      await sleep(250);
    }
    progress.context.pausedMs = (progress.context.pausedMs || 0) + Date.now() - pausedAt;
    progress.context.pauseStartedAt = null;
    progress.publish({ state: 'running', phase: previousPhase }, true);
    if (requested === 'cancel') throw new RunInterrupted('cancelled');
    if (requested === 'stop') return checkpoint(safeToStop);
    if (connectionLost) throw Object.assign(new Error('Connection closed while paused. Reconnecting after resume.'), { code: 'NoConnection' });
  }
  return { checkpoint, command, beginMessage() { inMessage = true; }, endMessage() { inMessage = false; }, dispose() { clearInterval(timer); } };
}
module.exports = { RunInterrupted, readControl, createControl };
