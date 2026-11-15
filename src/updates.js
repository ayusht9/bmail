export function createUpdater({ invoke, channel, changed }) {
  const state = { phase: 'idle', message: '', version: null, notes: '', currentVersion: '' };
  let pending = false;
  const publish = values => { Object.assign(state, values); changed(); };
  return {
    state,
    async check() {
      if (pending) return;
      pending = true;
      publish({ phase: 'checking', message: 'Checking for updates...' });
      try {
        const info = await invoke('check_update');
        publish({ currentVersion: info.currentVersion, version: info.version, notes: info.notes || '',
          phase: info.version ? 'available' : 'idle',
          message: !info.configured ? 'Updates are not configured for this build.' : info.version ? `Bmail ${info.version} is available.` : 'Bmail is up to date.' });
      } catch {
        publish({ phase: state.version ? 'available' : 'error', message: 'Could not check for updates. Check your connection and try again.' });
      } finally { pending = false; }
    },
    async install() {
      if (pending || !state.version) return;
      pending = true;
      publish({ phase: 'installing', message: 'Downloading update...' });
      const onProgress = channel();
      onProgress.onmessage = progress => publish({ message: progress.installing ? 'Installing update. Bmail will restart...' :
        progress.total ? `Downloading update: ${Math.min(100, Math.floor(progress.downloaded / progress.total * 100))}%` : `Downloading update: ${(progress.downloaded / 1048576).toFixed(1)} MB` });
      try {
        await invoke('install_update', { version: state.version, onProgress });
      } catch (error) {
        publish({ phase: 'available', message: `Update could not be installed: ${String(error)}` });
      } finally { pending = false; }
    },
  };
}
