const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getWebRoot } = require('./web-project');

// Use the current editor rather than a second, outdated working copy.
const root = getWebRoot();
const vite = path.join(path.dirname(require.resolve('vite/package.json', { paths: [root] })), 'bin/vite.js');
const result = spawnSync(process.execPath, [vite, 'build', '--outDir', path.join(__dirname, 'dist')], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
