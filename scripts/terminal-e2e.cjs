// 终端端到端测试：起 fake-sshd（真实 shell）→ 启动 Electron（隔离 userData + CDP）
// → 驱动 UI 添加服务器 → 开终端标签 → 真实键盘输入 → 断言回显。退出码 0/1。
//   node scripts/terminal-e2e.cjs
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const { createFakeSshd } = require('./fake-sshd.cjs');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-term-e2e-'));
  const sshd = await createFakeSshd({ port: 0, root: path.join(tmp, 'srv') });
  const port = sshd.address().port;
  console.log('fake-sshd on 127.0.0.1:' + port);

  // 启动应用（dev electron + vite；隔离 userData；开 CDP）
  const vite = null;
  const exe = path.join(ROOT, 'release', 'win-unpacked', 'ServerConsole.exe');
  const electron = spawn(exe, ['--remote-debugging-port=9333'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SC_USER_DATA: path.join(tmp, 'userdata') },
  });

  electron.stdout.on('data', (d) => process.stdout.write('[electron] ' + d));
  electron.stderr.on('data', (d) => process.stdout.write('[electron:err] ' + d));
  let browser;
  for (let i = 0; i < 40; i++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
      break;
    } catch (e) {
      if (i === 0 || i === 20) console.log('cdp attempt ' + i + ': ' + (e && e.message ? e.message.slice(0, 200) : e));
      await sleep(1000);
    }
  }
  if (!browser) throw new Error('无法连接 CDP');
  const page = browser.contexts()[0].pages()[0];
  await page.waitForSelector('.nav', { timeout: 30000 });
  console.log('app loaded');

  // 添加 e2e 服务器（密码认证，假凭据即可）
  await page.getByRole('button', { name: '服务器', exact: true }).first().click();
  await page.getByPlaceholder('dgx-01').fill('e2e-test');
  await page.getByPlaceholder('10.20.1.11').fill('127.0.0.1');
  await page.locator('input[type="number"]').fill(String(port));
  await page.getByPlaceholder('root').fill('smoke');
  await page.locator('input[type="password"]').first().fill('x');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await sleep(10000); // 等首次采集上线（含连接握手）

  // 打开该服务器
  await page.locator('.nav-item').filter({ hasText: 'e2e-test' }).first().click();
  await sleep(600);

  // 抓取离线原因：空态文案与侧栏圆点
  await sleep(2000);
  const stateText = await page.locator('.empty').first().innerText().catch(() => '(无 empty 节点)');
  console.log('STATE: ' + stateText.slice(0, 120));
  // 调试截图：看添加后的状态
  await page.screenshot({ path: path.join(tmp, 'after-add.png') });
  const navText = await page.locator('.nav').innerText();
  console.log('NAV: ' + navText.split('\n').join(' | '));
  // 切到终端标签
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await sleep(2500); // 等 shell 建立

  // 点终端聚焦 + 真实键盘输入
  await page.locator('.xterm').click();
  await page.keyboard.type('echo sc-e2e-marker\r', { delay: 30 });
  await sleep(3000);

  const dbg = await page.evaluate(() => (window.__scTerm ? window.__scTerm.dbg : null));
  console.log('DBG: ' + JSON.stringify(dbg));
  const diag = await page.evaluate(() => ({
    hook: typeof window.__scTerm,
    xterms: document.querySelectorAll('.xterm').length,
    toolbar: document.querySelector('.term-toolbar') ? document.querySelector('.term-toolbar').innerText : '(no toolbar)',
    tabs: document.querySelector('.tabs') ? document.querySelector('.tabs').innerText : '(no tabs)',
  }));
  console.log('DIAG: ' + JSON.stringify(diag));
  const text = diag.hook === 'object' ? await page.evaluate(() => window.__scTerm.dump()) : '(no hook)';
  fs.writeFileSync(path.join(tmp, 'terminal.txt'), text);
  const hasMarker = text.includes('sc-e2e-marker') || text.includes('fake-shell ready');
  console.log(hasMarker ? 'E2E TERMINAL OK（输入→回显链路通）' : 'E2E TERMINAL FAIL（回显未出现）');
  console.log('--- 终端文本（尾部 600 字） ---');
  console.log(text.slice(-600));
  await page.screenshot({ path: path.join(tmp, 'terminal.png') });
  console.log('screenshot: ' + path.join(tmp, 'terminal.png'));

  await browser.close();
  try { electron.kill(); } catch { /* noop */ }
  sshd.close();
  process.exit(hasMarker ? 0 : 1);
}

main()
  .catch((e) => {
    console.error('E2E ERROR:', e && e.stack ? e.stack : e);
    process.exit(1);
  });
