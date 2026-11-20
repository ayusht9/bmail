const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { syncRuntimeSources } = require('./runtime-sources.cjs');

if (process.platform !== 'win32') throw new Error('Build the Windows installer on Windows.');
const root = path.resolve(__dirname, '..');
const target = process.env.TAURI_ENV_TARGET_TRIPLE;
if (target && !target.startsWith(`${process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : 'i686'}-`)) {
  throw new Error('Use a Node runtime matching the Windows build architecture.');
}
const output = path.join(root, 'src-tauri/resources/engine');
if (process.argv.includes('--sources-only')) {
  if (!fs.existsSync(path.join(output, 'node.exe'))) throw new Error('Prepare the full runtime once before refreshing its sources.');
  console.log(`Refreshed ${syncRuntimeSources(root, output)} backup runtime source files.`);
  process.exit(0);
}
syncRuntimeSources(root, output);
for (const file of ['LICENSE', 'package.json', 'package-lock.json']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
fs.copyFileSync(process.execPath, path.join(output, 'node.exe'));
const nodeLicense = process.env.NODE_LICENSE_PATH || path.join(path.dirname(process.execPath), 'LICENSE');
if (!fs.existsSync(nodeLicense)) throw new Error('Set NODE_LICENSE_PATH to the LICENSE file from your Node.js distribution.');
fs.copyFileSync(nodeLicense, path.join(output, 'NODE-LICENSE.txt'));
// npm ci installs only the locked production dependency tree in the resource folder.
execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund'], {
  cwd: output, stdio: 'inherit', windowsHide: true,
});
console.log(`Prepared Windows ${process.arch} backup runtime (${process.version}).`);
