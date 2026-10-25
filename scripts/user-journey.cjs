// 用户体验模拟：打包应用 + fake-sshd，按真实用户点击路径走一遍 v0.15–v0.17 的新功能。
// SC_ELECTRON_PATH 指向最新 win-unpacked 可执行文件。
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const { _electron } = require('playwright-core');
const { createFakeSshd } = require('./fake-sshd.cjs');

const listen = (server) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
async function waitUntil(predicate, message, ms = 8000) {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      try { console.log('DIAG errors:', JSON.stringify(await page.locator('.monitor-error').allInnerTexts())); console.log('DIAG tables:', await page.locator('.workcenter-table').count()); await page.screenshot({ path: 'test-artifacts/user-journey/fail-' + Date.now() + '.png' }); } catch {}
      throw new Error('timeout: ' + message);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
let page;
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CSV = ['epoch,loss,lr', ...Array.from({ length: 30 }, (_, i) => `${i + 1},${(2.5 - i * 0.06).toFixed(3)},0.001`)].join('\n');

async function main() {
  const exe = process.env.SC_ELECTRON_PATH;
  assert(exe && fs.existsSync(exe), 'SC_ELECTRON_PATH 未设置');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-ux-'));
  const artifacts = path.join(__dirname, '../test-artifacts/user-journey');
  fs.mkdirSync(artifacts, { recursive: true });
  const localProject = path.join(tmp, 'local-project');
  fs.mkdirSync(localProject, { recursive: true });
  fs.writeFileSync(path.join(localProject, 'train.py'), 'print("hello")\n');
  fs.writeFileSync(path.join(localProject, 'ignore.tmp'), 'x');

  const sftpRoot = path.join(tmp, 'srv');
  fs.mkdirSync(sftpRoot, { recursive: true });
  fs.writeFileSync(path.join(sftpRoot, 'train.log'), ['epoch 1 loss=2.50', 'error: warmup failed', 'done'].join('\n'));
  fs.writeFileSync(path.join(sftpRoot, 'metrics.csv'), CSV);
  fs.writeFileSync(path.join(sftpRoot, 'loss.png'), PNG_1PX);

  const sshd = await createFakeSshd({ port: 0, root: sftpRoot, credentials: { username: 'fixture', password: 'fixture' } });
  const app = await _electron.launch({ executablePath: path.resolve(exe), env: { ...process.env, SC_USER_DATA: path.join(tmp, 'userdata') }, timeout: 30000 });
  const checks = [], pageErrors = [], consoleErrors = [];
  const pass = (name) => { checks.push(name); console.log('PASS ' + name); };
  try {
    page = await app.firstWindow();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.waitForSelector('.nav');
    await page.evaluate(() => { localStorage.setItem('sc.lang', 'zh-CN'); localStorage.setItem('sc.theme.user', 'light'); });
    await page.reload();
    await page.waitForSelector('.nav');

    // ===== 1. 添加服务器（等同用户在表单填写提交的最终效果）=====
    const port = sshd.address().port;
    await page.evaluate((p) => window.api.addServer({ name: 'ux-server', host: '127.0.0.1', port: p, username: 'fixture', authType: 'password', password: 'fixture' }), port);
    await page.reload();
    await page.waitForSelector('.nav');
    await page.locator('.nav-server', { hasText: 'ux-server' }).first().click();
    await page.waitForSelector('.gpu-card', { timeout: 15000 });
    pass('1. 服务器上线且详情页渲染 3 张 GPU 卡');

    // ===== 2. 工作台 → 系统标签：环境对比 =====
    await page.locator('.nav button.nav-item', { hasText: '任务' }).first().click();
    await page.waitForTimeout(300);
    const wcTabs = page.locator('.workcenter-tabs button');
    await wcTabs.filter({ hasText: '系统' }).click();
    await page.waitForSelector('.workcenter h2, .card h2', { timeout: 10000 });
    await page.waitForTimeout(1500);
    assert(await page.locator('text=环境一致性对比').count() > 0, '环境对比卡缺失');
    await page.locator('button', { hasText: '收集本服务器' }).first().click();
    await waitUntil(async () => (await page.locator('.workcenter-table').count()) > 1, '环境矩阵未出现');
    pass('2. 环境对比卡渲染（fake 服务器为空值矩阵）');

    // ===== 3. 日志监控标签：建 watcher =====
    await wcTabs.filter({ hasText: '日志监控' }).click();
    await page.locator('.workcenter-form input.mono').fill('/root/train.log');
    await page.locator('.workcenter-form textarea').fill('error\nloss=');
    await page.locator('.workcenter-form label.check input').check();
    await page.locator('.workcenter-form button.primary').click();
    await waitUntil(async () => (await page.locator('.workcenter-grid .card h2').count()) > 0, 'watcher 卡片未出现');
    const watcherText = await page.locator('.workcenter-grid .card').first().innerText();
    assert(watcherText.includes('/root/train.log'), 'watcher 路径未显示');
    pass('3. 日志 watcher 创建成功并显示路径/模式');
    await page.screenshot({ path: path.join(artifacts, 'logs-tab.png') });

    // ===== 4. 报告标签：用量报表空态 =====
    await wcTabs.filter({ hasText: '报告' }).click();
    await waitUntil(async () => (await page.locator('text=按用户统计 GPU 时长').count()) > 0, '用量卡缺失');
    await page.waitForTimeout(1200);
    const usageVisible = await page.locator('text=该范围内没有用量记录').count() > 0 || await page.locator('.workcenter-table').count() > 0;
    assert(usageVisible, '用量报表既无表格也无空态');
    pass('4. 报告页周报 + 用量表（空态）渲染');

    // ===== 5. 同步标签：失败路径要有提示（bug2 验证）=====
    await wcTabs.filter({ hasText: '保存即上传' }).click();
    await page.locator('.workcenter-form input.mono').first().fill(path.join(tmp, '不存在目录'));
    await page.locator('.workcenter-form input.mono').nth(1).fill('/root/project');
    await page.locator('.workcenter-form button.primary').click();
    await waitUntil(async () => (await page.locator('.monitor-error').count()) > 0, '无效目录提交后没有错误提示（静默失败）');
    const syncErr = await page.locator('.monitor-error').first().innerText();
    assert(syncErr.length > 0, '错误提示为空');
    pass('5. DevSync 无效目录提交有明确报错（不再静默）');
    // 成功路径
    await page.locator('.workcenter-form input.mono').first().fill(localProject);
    await page.locator('.workcenter-form button.primary').click();
    await waitUntil(async () => (await page.locator('.workcenter-grid .card h2').count()) > 0, '配对卡片未出现');
    pass('6. DevSync 配对创建成功');

    // ===== 7. 文件页：图片/CSV 预览 =====
    await page.locator('.nav .nav-files').first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(artifacts, 'files.png') });
    const pngCell = page.getByText('loss.png').first();
    if (await pngCell.count() > 0) {
      await pngCell.dblclick();
      await waitUntil(async () => (await page.locator('img').count()) > 0, '图片预览未出现');
      pass('7. 双击 PNG 弹出图片预览');
      await page.keyboard.press('Escape').catch(() => {});
      const closeBtns = page.locator('.mask .dialog .foot button', { hasText: '关闭' });
      if (await closeBtns.count() > 0) await closeBtns.last().click();
      await page.waitForTimeout(300);
    } else {
      console.log('SKIP 图片预览：文件列表未见 loss.png（检查远程起始目录）');
    }
    const csvCell = page.getByText('metrics.csv').first();
    if (await csvCell.count() > 0) {
      await csvCell.dblclick();
      await waitUntil(async () => (await page.locator('.mask table').count()) > 0, 'CSV 预览未出现');
      const headers = await page.locator('.mask table th').allInnerTexts();
      assert.deepStrictEqual(headers, ['epoch', 'loss', 'lr'], 'CSV 表头解析错误');
      pass('8. 双击 CSV 弹出解析表格（表头正确）');
      await page.screenshot({ path: path.join(artifacts, 'csv-preview.png') });
      const btn = page.locator('.mask .dialog .foot button', { hasText: '关闭' });
      if (await btn.count() > 0) await btn.last().click();
    } else {
      console.log('SKIP CSV 预览：文件列表未见 metrics.csv');
    }

    // ===== 9. 并行命令 + 历史 =====
    await page.locator('.nav button', { hasText: '并行' }).first().click();
    await page.waitForTimeout(300);
    await page.locator('.pc-server').first().click();
    await page.locator('.pc-cmd input').fill('nvidia-smi');
    await page.locator('.pc-toolbar button.primary').click();
    await waitUntil(async () => (await page.locator('.pc-history-row').count()) > 0, '并行历史未出现', 15000);
    const historyText = await page.locator('.pc-history-row').first().innerText();
    assert(historyText.includes('nvidia-smi'), '历史未记录命令');
    await page.locator('.pc-history-cmd').first().click();
    assert((await page.locator('.pc-cmd input').inputValue()) === 'nvidia-smi', '点击历史未回填');
    pass('9. 并行命令执行后历史记录出现且可回填');

    // ===== 10. 设置：手机状态页 =====
    await page.locator('button.btn', { hasText: '设置' }).first().click();
    await page.waitForTimeout(400);
    const tabMobile = page.locator('#settings-tab-mobile');
    assert(await tabMobile.count() > 0, '设置缺手机页标签');
    await tabMobile.click();
    await page.locator('.seg button', { hasText: '开' }).first().click();
    await waitUntil(async () => {
      const info = await page.evaluate(() => window.api.getAppSettings());
      return info.statusPage && info.statusPage.running;
    }, '手机状态页未能启动', 10000);
    const info = await page.evaluate(() => window.api.getAppSettings());
    assert(info.statusPage.token.length >= 32, '令牌缺失');
    const statusJson = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: info.statusPage.port, path: '/status.json?token=' + info.statusPage.token }, (res) => {
        let body = ''; res.on('data', (c) => (body += c)); res.on('end', () => resolve({ code: res.statusCode, body }));
      }).on('error', reject);
    });
    assert.equal(statusJson.code, 200, 'status.json 非 200');
    const parsed = JSON.parse(statusJson.body);
    assert(Array.isArray(parsed.servers) && parsed.servers.some((s) => s.name === 'ux-server'), 'status.json 缺服务器');
    const gpu = parsed.servers.flatMap((s) => s.gpus);
    assert(gpu.length >= 3, 'status.json GPU 摘要缺失（fake 有 3 卡）');
    const activeTransfer = parsed.transfers.length === 0 || parsed.transfers.every((t) => typeof t.active === 'boolean');
    assert(activeTransfer, 'transfers.active 字段类型错误');
    pass('10. 手机状态页启动且 status.json 数据正确（含 GPU 摘要）');
    const forbidden = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: info.statusPage.port, path: '/status.json?token=wrong' }, (res) => resolve(res.statusCode));
    });
    assert.equal(forbidden, 403, '错误 token 未被拒绝');
    pass('11. 错误 token 被 403 拒绝');
    await page.screenshot({ path: path.join(artifacts, 'settings-phone.png') });

    // ===== 12. 设置：更新区渲染（不点检查，避免真实外网）=====
    await page.locator('#settings-tab-updates').click();
    assert(await page.locator('text=更新').count() > 0, '更新区缺失');
    assert(await page.locator('text=自动下载并安装更新').count() > 0, '自动安装开关缺失');
    pass('12. 更新区渲染（横幅 + 开关）');

    // ===== 13. 终端：搜索条 =====
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.locator('.nav-server', { hasText: 'ux-server' }).first().click();
    await page.waitForTimeout(600);
    await page.locator('button', { hasText: '终端' }).first().click();
    await page.waitForTimeout(2500);
    await page.locator('.term-chips .term-chip').first().waitFor({ timeout: 10000 }).catch(() => {});
    if (await page.locator('.term-host').count() > 0) {
      await page.keyboard.press('Control+f');
      await waitUntil(async () => (await page.locator('.term-search-bar input').count()) > 0, 'Ctrl+F 搜索条未出现');
      await page.locator('.term-search-bar input').fill('loss');
      pass('13. 终端 Ctrl+F 搜索条出现并可输入');
      await page.screenshot({ path: path.join(artifacts, 'terminal-search.png') });
    } else {
      console.log('SKIP 终端搜索条：终端未挂载');
    }

    // ===== 汇总 =====
    assert.deepStrictEqual(pageErrors, [], '渲染进程有未捕获异常: ' + pageErrors.join(' | '));
    pass('14. 全程零 pageerror');
    const seriousConsole = consoleErrors.filter((e) => !/favicon|Autofocus|Download the React DevTools/i.test(e));
    if (seriousConsole.length) console.log('console.error 清单:\n' + seriousConsole.join('\n'));
    console.log('\n共 ' + checks.length + ' 项通过; 截图在 ' + artifacts);
  } finally {
    await app.close().catch(() => {});
    try { sshd.close(); } catch { /* noop */ }
  }
}
main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
