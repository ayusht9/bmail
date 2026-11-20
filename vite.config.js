import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeSources, syncRuntimeSources } from './scripts/runtime-sources.cjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const runtime = path.join(root, 'src-tauri/resources/engine');

export default defineConfig({
  plugins: [{
    name: 'bmail-development-runtime',
    apply: 'serve',
    configureServer(server) {
      const sync = file => {
        if (file && (path.dirname(path.resolve(file)) !== path.join(root, 'engine') || !runtimeSources.includes(path.basename(file)))) return;
        if (fs.existsSync(path.join(runtime, 'node.exe'))) syncRuntimeSources(root, runtime);
      };
      sync();
      server.watcher.add(runtimeSources.map(name => path.join(root, 'engine', name)));
      server.watcher.on('change', sync);
      server.watcher.on('add', sync);
    },
  }],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Tauri watches Rust sources. Vite must not watch Cargo's locked DLLs or
    // the generated backup runtime inside this directory on Windows.
    watch: { ignored: ['**/src-tauri/**'] }
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // The desktop CSP allows same-origin images; embedded data URLs are blocked.
    assetsInlineLimit: 0,
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    rollupOptions: { input: { main: 'index.html', splash: 'splash.html' } },
  }
});
