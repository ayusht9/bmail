const fs = require('node:fs');
const path = require('node:path');

function dataDirectory(engineDirectory = __dirname, configuredDirectory = process.env.MAIL_VAULT_DATA_DIR) {
  if (configuredDirectory) return configuredDirectory;
  // Source checkouts keep standalone data at the repository root. Bundled
  // runtimes carry their own package.json and retain the original fallback.
  const parent = path.dirname(engineDirectory);
  return fs.existsSync(path.join(parent, 'package.json')) ? parent : engineDirectory;
}

function backupEnabled(data, kind) {
  const parent = path.dirname(path.resolve(data));
  const base = path.basename(parent).toLowerCase() === 'accounts' ? path.dirname(parent) : data;
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(base, 'desktop-settings.json'), 'utf8').replace(/^\uFEFF/, ''));
    return settings[kind === 'schedule' ? 'scheduledBackupsEnabled' : 'cloudBackupsEnabled'] !== false;
  } catch (error) { return error.code === 'ENOENT'; }
}

module.exports = { dataDirectory, backupEnabled };
