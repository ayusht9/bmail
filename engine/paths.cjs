const fs = require('node:fs');
const path = require('node:path');

function dataDirectory(engineDirectory = __dirname, configuredDirectory = process.env.MAIL_VAULT_DATA_DIR) {
  if (configuredDirectory) return configuredDirectory;
  // Source checkouts keep standalone data at the repository root. Bundled
  // runtimes carry their own package.json and retain the original fallback.
  const parent = path.dirname(engineDirectory);
  return fs.existsSync(path.join(parent, 'package.json')) ? parent : engineDirectory;
}

module.exports = { dataDirectory };
