// Production renderer with explicitly simulated monitoring/history IPC.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright-core');
const { installFixture, emitSamples } = require('./renderer-fixture.cjs');
async function main() {
  const root = path.resolve(__dirname, '../dist'), output = path.resolve(__dirname, '../test-artifacts/monitor');
  fs.mkdirSync(output, {recursive: true});
  const server = http.createServer((req, res) => {
    const target = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', {'.html':'text/html','.css':'text/css','.js':'text/javascript'}[path.extname(target)] || 'application/octet-stream'); fs.createReadStream(target).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser; const checks = [], errors = [], pass = (name) => {checks.push(name);console.log('PASS ' + name);};
  try {
    const executablePath = [process.env.SC_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p));
    browser = await chromium.launch({headless: true,...(executablePath ? {executablePath} : {})});
    const page = await browser.newPage({viewport:{width:1440,height:1000}}); page.on('pageerror',(e)=>errors.push(e.message));
    await page.addInitScript(installFixture);
    await page.addInitScript(() => {
      const api = window.api; window.__monitor = { calls:{}, hold:false, resolve:null };
      window.api = new Proxy(api,{get:(target,key)=>String(key).startsWith('on') || key==='platform' ? target[key] : (...args)=>{
        window.__monitor.calls[key]=(window.__monitor.calls[key]||0)+1;
        const result=target[key](...args);
        return key==='historyQuery' && window.__monitor.hold ? new Promise((resolve)=>{window.__monitor.resolve=()=>result.then(resolve);}) : result;
      }});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`); await emitSamples(page);
    assert.equal(await page.locator('.gpu-ring svg').count(),2); pass('each GPU has a utilization ring');
    await page.screenshot({path:path.join(output,'overview-en.png')});
    await page.locator('.resource-gpu').first().click(); await page.waitForSelector('.gpu-card[data-focused]'); pass('ring click opens and highlights its GPU');
    await page.locator('.nav-server').nth(1).locator('..').locator('.dot').click();
    assert.equal(await page.locator('.nav-server').nth(1).getAttribute('aria-current'),'page'); pass('server status-dot click switches with one click');
    await page.evaluate(()=>window.__fixture.callbacks.onSnapshot({id:'fake1',status:'online',collectedAt:Date.now()-120000,gpus:[{index:0,name:'NVIDIA H100',util:50,memUsed:1000,memTotal:81920,temp:50,power:100,procs:[]}],processes:[],cpuUsage:25,memUsed:2,memTotal:8,loadAvg:[0,0,0]}));
    await page.locator('.nav-server').first().click(); await page.waitForSelector('.gpu-card');
    assert(await page.locator('.inline-status').count()>0); pass('stale server switches show cached metrics and sample age immediately');
    await page.locator('.nav-files').first().click(); await page.waitForSelector('.fm-table');
    await page.evaluate(()=>{window.__savedFiles=document.querySelector('.fm');});
    const homeBefore=await page.evaluate(()=>window.__monitor.calls.sftpHome);
    await page.locator('.nav-files').nth(1).click(); await page.waitForSelector('.fm:visible');
    await page.locator('.nav-files').first().click();
    assert(await page.locator('.fm:visible').evaluate((el)=>el===window.__savedFiles));
    assert.equal(await page.evaluate(()=>window.__monitor.calls.sftpHome),homeBefore+1); pass('visited file panes retain DOM and do not repeat home requests');
    await page.locator('.tabs button').last().click(); await page.waitForSelector('.monitor-chart');
    for(let i=0;i<5;i++) {
      await page.locator('.monitor-ranges button').nth(i).click(); await page.waitForSelector('.monitor-chart');
      assert.equal(await page.evaluate(()=>window.__fixture.historyRequests.at(-1).rangeMs),[1800000,3600000,43200000,86400000,604800000][i]);
    }
    pass('all five visible range buttons request their exact time windows');
    await page.locator('.monitor-toolbar select').first().selectOption('gpu:0'); await page.waitForSelector('.monitor-chart');
    await page.evaluate(()=>window.__monitor.hold=true);
    await page.locator('.monitor-toolbar select').nth(1).selectOption('power');
    assert.equal(await page.locator('.monitor-toolbar select').first().inputValue(),'gpu:0');
    assert((await page.locator('.monitor-toolbar select').first().locator('option:checked').innerText()).includes('GPU 0'));
    await page.evaluate(()=>{window.__monitor.hold=false;window.__monitor.resolve();}); await page.waitForSelector('.monitor-chart');
    pass('GPU selection remains visible while a metric query is pending');
    await page.screenshot({path:path.join(output,'history-en.png')});
    assert.deepEqual(errors,[]); pass('monitoring interactions have no renderer errors');
    fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({version:require('../package.json').version,scope:'Production renderer with simulated IPC, no real GPU evidence',checks,errors},null,2)+'\n');
  } finally { if(browser)await browser.close(); await new Promise((resolve)=>server.close(resolve)); }
}
main().catch((e)=>{console.error(e);process.exitCode=1;});
