// Exercise the app built by the current runner; do not launch portable wrappers or mounted DMGs.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const candidates = process.platform === 'win32' ? ['release/win-unpacked/ServerConsole.exe']
  : process.platform === 'darwin' ? ['release/mac-universal/ServerConsole.app/Contents/MacOS/ServerConsole', 'release/mac-arm64/ServerConsole.app/Contents/MacOS/ServerConsole', 'release/mac/ServerConsole.app/Contents/MacOS/ServerConsole']
  : ['release/linux-unpacked/serverconsole', 'release/linux-unpacked/server-console'];
const executablePath = candidates.map((name) => path.join(root, name)).find((name) => fs.existsSync(name));
if (!executablePath) throw new Error('Current unpacked application missing: ' + candidates.join(', '));
const result = spawnSync(process.execPath, [path.join(__dirname, 'terminal-e2e.cjs')], {cwd: root, env: {...process.env, SC_ELECTRON_PATH: executablePath}, stdio: 'inherit', timeout: 180000, windowsHide: true});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
