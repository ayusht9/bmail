const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createProgress(root, atomicWrite, context = {}) {
  context.runId ||= crypto.randomUUID();
  context.startedAt ||= new Date().toISOString();
  context.transferredBytes ||= 0;
  context.downloaded ||= 0;
  context.savedBytes ||= 0;
  const state = {
    runId: context.runId, pid: process.pid, startedAt: context.startedAt,
    state: 'running', phase: 'connecting', totalMessages: null, processedMessages: 0,
    downloaded: context.downloaded, savedBytes: context.savedBytes,
    totalFolders: 0, completedFolders: 0, currentFolder: null,
    currentMessageBytes: 0, currentMessageTotal: 0,
  };
  let lastWrite = 0;
  function publish(patch = {}, force = false) {
    Object.assign(state, patch);
    const now = Date.now();
    if (!force && now - lastWrite < 500) return;
    const elapsedSeconds = Math.max(0, (now - Date.parse(context.startedAt) - (context.pausedMs || 0) - (context.pauseStartedAt ? now - context.pauseStartedAt : 0)) / 1000);
    const remaining = state.totalMessages == null ? null : Math.max(0, state.totalMessages - state.processedMessages);
    const snapshot = {
      ...state, updatedAt: new Date(now).toISOString(), elapsedSeconds,
      transferredBytes: context.transferredBytes,
      bytesPerSecond: elapsedSeconds > 0 && state.state !== 'paused' ? context.transferredBytes / elapsedSeconds : 0,
      etaSeconds: state.downloaded >= 3 && remaining != null && state.state === 'running'
        ? Math.ceil(remaining * elapsedSeconds / state.downloaded) : null,
    };
    atomicWrite(path.join(root, 'progress.json'), JSON.stringify(snapshot, null, 2) + '\n');
    lastWrite = now;
  }
  publish({}, true);
  const heartbeat = setInterval(() => publish({}, true), 2000);
  heartbeat.unref();
  return { state, context, publish, finish(patch) { clearInterval(heartbeat); publish(patch, true); } };
}
module.exports = { createProgress };
