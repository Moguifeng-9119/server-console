// Deliberately CI-only: NSIS changes registered installation state even with /D.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { _electron } = require('playwright-core');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');

async function checkInstallUpgrade() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'win32') throw new Error('Installer checks run only in an isolated Windows GitHub Actions runner');
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-install-upgrade-'));
  const installDirectory = path.join(owned, 'app'), userData = path.join(owned, 'userdata'), executablePath = path.join(installDirectory, 'ServerConsole.exe');
  const receipt = { version: require('../package.json').version, previous: '0.17.1', checks: [], passed: false };
  const artifacts = path.join(root, 'test-artifacts', 'install-upgrade'); fs.mkdirSync(artifacts, { recursive: true });
  let application;
  try {
    const metadataResponse = await fetch('https://api.github.com/repos/Moguifeng-9119/server-console/releases/tags/v0.17.1', { headers: { 'user-agent': 'ServerConsole-installer-ci' }, signal: AbortSignal.timeout(30000) });
    assert(metadataResponse.ok, 'Previous release metadata unavailable');
    const metadata = await metadataResponse.json(), asset = metadata.assets.find((item) => item.name === 'ServerConsole-Setup-0.17.1.exe');
    assert(asset, 'Previous NSIS installer missing');
    const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(180000) }); assert(response.ok && response.body, 'Previous installer download failed');
    const previousInstaller = path.join(owned, 'previous.exe'); await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(previousInstaller));
    const digest = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(previousInstaller)) digest.update(chunk); receipt.previousSha256 = digest.digest('hex');
    if (asset.digest) assert.equal(asset.digest, 'sha256:' + receipt.previousSha256, 'Previous installer digest mismatch');
    const install = async (file) => { await run(file, ['/S', '/currentuser', '/D=' + installDirectory], { windowsHide: true, timeout: 180000 }); assert(fs.existsSync(executablePath), 'Installed executable missing'); };
    const launch = async () => {
      const app = await _electron.launch({ executablePath, env: { ...process.env, SC_USER_DATA: userData }, timeout: 45000 });
      const page = await app.firstWindow(); await page.waitForFunction(() => typeof window.api?.getAppSettings === 'function'); return { app, page };
    };
    await install(previousInstaller); let running = await launch(); application = running.app;
    assert.equal(await application.evaluate(({ app }) => app.getVersion()), receipt.previous);
    await running.page.evaluate(async () => { localStorage.setItem('sc.lang', 'zh-CN'); await window.api.setAppSettings({ closeAction: 'exit' }); await window.api.setAppLanguage('zh-CN'); });
    await application.close(); application = null;
    fs.mkdirSync(userData, { recursive: true });
    const original = { closeAction: 'exit', language: 'zh-CN', updateAutoInstall: false, statusPage: { enabled: false, token: crypto.randomBytes(32).toString('hex'), port: 23143 }, migrationMarker: { retained: true } };
    fs.writeFileSync(path.join(userData, 'appsettings.json'), JSON.stringify(original));
    receipt.checks.push('Previous NSIS installed and launched in isolated directory');
    await install(path.join(root, 'release', 'ServerConsole-Setup-' + receipt.version + '.exe'));
    running = await launch(); application = running.app;
    assert.equal(await application.evaluate(({ app }) => app.getVersion()), receipt.version);
    const restored = await running.page.evaluate(() => window.api.getAppSettings()); assert.equal(restored.language, 'zh-CN'); assert.equal(restored.closeAction, 'exit');
    await running.page.evaluate(() => window.api.setAppLanguage('fr'));
    const persisted = JSON.parse(fs.readFileSync(path.join(userData, 'appsettings.json'), 'utf8'));
    assert.equal(persisted.language, 'fr'); assert.equal(persisted.updateAutoInstall, false); assert.deepEqual(persisted.statusPage, original.statusPage); assert.deepEqual(persisted.migrationMarker, original.migrationMarker);
    receipt.checks.push('Upgrade preserves settings; changing language retains update/status/extension fields');
    await application.close(); application = null; receipt.passed = true;
  } finally {
    if (application) await application.close().catch(() => {});
    // Exact CI-owned targets only. Never clean an arbitrary app installation.
    assert(path.resolve(owned).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(owned).startsWith('sc-install-upgrade-'));
    fs.writeFileSync(path.join(artifacts, 'checks.json'), JSON.stringify(receipt, null, 2));
    fs.rmSync(owned, { recursive: true, force: true });
  }
  process.stdout.write('Isolated Windows NSIS install/upgrade checks passed\n');
}
if (require.main === module) checkInstallUpgrade().catch((error) => { process.stderr.write(String(error.message || error) + '\n'); process.exitCode = 1; });
module.exports = { checkInstallUpgrade };
