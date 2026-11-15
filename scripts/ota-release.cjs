const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function manifest({ version, repository, installer, signature, notes = '', date = new Date().toISOString() }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use a stable major.minor.patch version.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Expected GitHub owner/repository.');
  if (!installer.endsWith('_x64-setup.exe') || path.basename(installer) !== installer) throw new Error('Expected a Windows x64 NSIS installer filename.');
  if (!signature.trim()) throw new Error('A signed installer is required.');
  return { version, notes, pub_date: date, platforms: { 'windows-x86_64': {
    signature: signature.trim(), url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(installer)}`,
  } } };
}

function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Release builds require Windows x64 and x64 Node.js.');
  const config = require('../src-tauri/tauri.conf.json');
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('Set TAURI_SIGNING_PRIVATE_KEY to your private key path.');
  if (!config.plugins?.updater?.pubkey) throw new Error('Configure the updater public key before building a release.');
  if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== `v${config.version}`) throw new Error('Release tag must match the app version.');
  const output = path.resolve('.tools/ota-release');
  fs.mkdirSync(output, { recursive: true });
  const overlay = path.join(output, 'tauri.release.conf.json');
  fs.writeFileSync(overlay, JSON.stringify({ bundle: { createUpdaterArtifacts: true } }));
  execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run tauri:build -- --config .tools/ota-release/tauri.release.conf.json'], { stdio: 'inherit', windowsHide: true });
  const bundle = path.resolve('src-tauri/target/release/bundle/nsis');
  const installer = `Bmail_${config.version}_x64-setup.exe`;
  const signature = fs.readFileSync(path.join(bundle, `${installer}.sig`), 'utf8');
  const data = manifest({ version: config.version, repository: process.env.GITHUB_REPOSITORY || 'ayusht9/bmail', installer, signature,
    notes: process.env.BMAIL_RELEASE_NOTES || `Bmail ${config.version}` });
  fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify(data, null, 2) + '\n');
  fs.copyFileSync(path.join(bundle, installer), path.join(output, installer));
  fs.copyFileSync(path.join(bundle, `${installer}.sig`), path.join(output, `${installer}.sig`));
  console.log(`Signed release artifacts: ${output}`);
}

module.exports = { manifest };
if (require.main === module) main();
