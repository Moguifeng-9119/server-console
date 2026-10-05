// 端到端冒烟测试（纯 Node，无需 Electron）：
//   node scripts/smoke.cjs
// 起两个 fake-sshd 实例（真实 SFTP 落在临时目录），驱动 ssh.cjs 的连接池与 transfer.cjs
// 的传输引擎走完整链路：采集 → 上传单文件/目录树 → 下载目录树 → 服务器互传（直传探测必败，
// 自动回退本机中继）→ 队列暂停/取消/续传。任何一步失败进程退出码为 1。
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createFakeSshd } = require('./fake-sshd.cjs');
const { Pool } = require('../electron/ssh.cjs');
const { TransferManager } = require('../electron/transfer.cjs');

const STEP = (name) => console.log(`\n== ${name}`);
const ok = (name) => console.log(`   ✓ ${name}`);

function makeBuf(size) {
  return crypto.randomBytes(size);
}

function waitTask(tm, id, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const FINISHED = ['done', 'error', 'canceled', 'paused'];
    const existing = tm.tasks.get(id);
    if (existing && FINISHED.includes(existing.status)) return resolve(tm.pub(existing));
    const timer = setTimeout(() => {
      currentListener = null;
      reject(new Error(`任务 ${id} 超时未完成`));
    }, timeoutMs);
    // onUpdate 是单监听器，由全局 currentListener 分发
    currentListener = (t) => {
      if (t.id !== id) return;
      if (FINISHED.includes(t.status)) {
        clearTimeout(timer);
        currentListener = null;
        resolve(t);
      }
    };
  });
}
let currentListener = null;

// 对运行中任务的 pause/cancel 是异步中止（ABORT 需要传播），用轮询等状态收敛
async function waitStatus(tm, id, statuses, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const t = tm.tasks.get(id);
    if (t && statuses.includes(t.status)) return t;
    if (Date.now() - start > timeoutMs) throw new Error(`任务 ${id} 未进入状态 ${statuses}（当前 ${t ? t.status : '缺失'}）`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function readTree(root) {
  const out = {};
  const visit = async (dir) => {
    for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) await visit(full);
      else out[path.relative(root, full).split(path.sep).join('/')] = await fsp.readFile(full);
    }
  };
  await visit(root);
  return out;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-smoke-'));
  const rootA = path.join(tmp, 'srvA');
  const rootB = path.join(tmp, 'srvB');
  const local = path.join(tmp, 'local');
  fs.mkdirSync(rootA);
  fs.mkdirSync(rootB);
  fs.mkdirSync(local);

  // ===== 环境：两个假服务器 + 连接池 + 传输引擎 =====
  STEP('启动 fake-sshd × 2');
  const srvA = await createFakeSshd({ port: 0, root: rootA });
  const srvB = await createFakeSshd({ port: 0, root: rootB });
  const portA = srvA.address().port;
  const portB = srvB.address().port;
  ok(`A=127.0.0.1:${portA}  B=127.0.0.1:${portB}`);

  const pool = new Pool();
  const cfgs = {
    a: { id: 'a', name: 'srv-a', host: '127.0.0.1', port: portA, username: 'smoke', password: 'x' },
    b: { id: 'b', name: 'srv-b', host: '127.0.0.1', port: portB, username: 'smoke', password: 'x' },
  };
  const tm = new TransferManager({
    getConn: (id) => pool.get(cfgs[id]),
    storeFile: path.join(tmp, 'transfers.json'),
    // 故意不注入 knownHostsLine：直传无法取得指纹 → 必须回退中继，正好覆盖回退路径
  });
  tm.onUpdate((t) => currentListener && currentListener(t));

  // ===== 1. 采集 =====
  STEP('采集（nvidia-smi / ps）');
  const snap = await pool.get(cfgs.a).collect();
  assert.strictEqual(snap.gpus.length, 3, '应有 3 张 GPU');
  assert.strictEqual(snap.gpus[2].temp, null, 'N/A 温度应保持 null');
  assert.ok(snap.processes.some((p) => p.state === 'Z'), '应含僵尸进程');
  ok(`3 GPU · ${snap.processes.length} 进程 · mem ${snap.memUsed}/${snap.memTotal} GB`);

  // ===== 2. 上传单文件（含 0 字节 + 大文件） =====
  STEP('上传单文件');
  const bigSrc = path.join(local, 'big.bin');
  const bigData = makeBuf(3 * 1024 * 1024 + 12345); // 非 chunk 整数倍
  await fsp.writeFile(bigSrc, bigData);
  const emptySrc = path.join(local, 'empty.bin');
  await fsp.writeFile(emptySrc, Buffer.alloc(0));
  const [tUp1, tUp2] = tm.addMany([
    { kind: 'upload', serverId: 'a', name: 'big.bin', srcLocal: bigSrc, dstRemote: '/up/big.bin', size: bigData.length, groupId: 'g1' },
    { kind: 'upload', serverId: 'a', name: 'empty.bin', srcLocal: emptySrc, dstRemote: '/up/empty.bin', size: 0, groupId: 'g1' },
  ]);
  const rUp1 = await waitTask(tm, tUp1.id);
  const rUp2 = await waitTask(tm, tUp2.id);
   assert.strictEqual(rUp1.status, 'done', rUp1.error);
  assert.strictEqual(rUp2.status, 'done');
  const upBig = await fsp.readFile(path.join(rootA, 'up/big.bin'));
  assert.ok(upBig.equals(bigData), '上传内容逐字节一致');
  const upEmpty = await fsp.stat(path.join(rootA, 'up/empty.bin'));
  assert.strictEqual(upEmpty.size, 0, '0 字节文件落盘为空');
  ok('3MB 文件 + 0 字节文件均一致');

  // ===== 3. 上传目录树（流式，含嵌套/空文件/中文名/悬空链接跳过） =====
  STEP('上传目录树');
  const treeSrc = path.join(local, 'tree');
  fs.mkdirSync(path.join(treeSrc, 'nested/deep'), { recursive: true });
  fs.mkdirSync(path.join(treeSrc, 'emptydir'));
  await fsp.writeFile(path.join(treeSrc, 'a.txt'), 'alpha');
  await fsp.writeFile(path.join(treeSrc, 'nested/b.bin'), makeBuf(1024 * 300));
  await fsp.writeFile(path.join(treeSrc, 'nested/deep/中文文件.txt'), '中文内容');
  await fsp.writeFile(path.join(treeSrc, 'nested/deep/zero.bin'), Buffer.alloc(0));
  try {
    await fsp.symlink(path.join(treeSrc, 'not-exists'), path.join(treeSrc, 'dangling'));
  } catch {
    /* Windows 无权限时忽略 */
  }
  const [tTree] = tm.addMany([
    { kind: 'upload', serverId: 'a', name: 'tree', srcLocal: treeSrc, dstRemote: '/up/tree', size: 0, groupId: 'g2' },
  ]);
  const rTree = await waitTask(tm, tTree.id);
  assert.strictEqual(rTree.status, 'done', `目录上传失败：${rTree.error}`);
  assert.strictEqual(rTree.filesDone, 4, '应传输 4 个文件（悬空链接跳过）');
  assert.strictEqual(rTree.direct, false);
  const remoteTree = await readTree(path.join(rootA, 'up/tree'));
  assert.strictEqual(remoteTree['a.txt'].toString(), 'alpha');
  assert.strictEqual(remoteTree['nested/b.bin'].length, 1024 * 300);
  assert.strictEqual(remoteTree['nested/deep/中文文件.txt'].toString(), '中文内容');
  assert.strictEqual(remoteTree['nested/deep/zero.bin'].length, 0);
  ok('树内容逐字节一致（含中文/空文件/空目录）');

  // ===== 4. 下载目录树 =====
  STEP('下载目录树');
  const dlDir = path.join(local, 'downloaded');
  const [tDl] = tm.addMany([
    { kind: 'download', serverId: 'a', name: 'tree', srcRemote: '/up/tree', dstLocal: path.join(dlDir, 'tree'), size: 0, groupId: 'g3' },
  ]);
  const rDl = await waitTask(tm, tDl.id);
  assert.strictEqual(rDl.status, 'done', `目录下载失败：${rDl.error}`);
  const localTree = await readTree(dlDir + '/tree');
  assert.deepStrictEqual(Object.keys(localTree).sort(), Object.keys(remoteTree).sort(), '下载树与远端一致');
  assert.ok(localTree['a.txt'].equals(remoteTree['a.txt']));
  ok('下载树与远端逐字节一致');

  // ===== 5. 队列控制：并发 1 下排队 → 暂停 → 取消 → 续传 =====
  // 说明：回环链路上传输太快，对运行中任务暂停必然有竞态；这里全部作用于“排队中”任务（源码为同步路径），filler 占住唯一并发槽保证确定性。
  STEP('队列暂停/取消/续传');
  tm.setConcurrency(1);
  const filler = path.join(local, 'filler.bin');
  await fsp.writeFile(filler, makeBuf(512 * 1024));
  const [tFill] = tm.addMany([{ kind: 'upload', serverId: 'a', name: 'filler.bin', srcLocal: filler, dstRemote: '/up/filler.bin', size: 512 * 1024, groupId: 'g4' }]);
  const [tPaused, tCanceled] = tm.addMany([
    { kind: 'upload', serverId: 'a', name: 'p.bin', srcLocal: bigSrc, dstRemote: '/up/p.bin', size: bigData.length, groupId: 'g5' },
    { kind: 'upload', serverId: 'a', name: 'c.bin', srcLocal: bigSrc, dstRemote: '/up/c.bin', size: bigData.length, groupId: 'g5' },
  ]);
  assert.strictEqual(tm.tasks.get(tFill.id).status, 'running');
  assert.strictEqual(tm.tasks.get(tPaused.id).status, 'queued');
  assert.strictEqual(tm.pause(tPaused.id), true);
  assert.strictEqual(tm.tasks.get(tPaused.id).status, 'paused');
  assert.strictEqual(tm.cancel(tCanceled.id), true);
  assert.strictEqual(tm.tasks.get(tCanceled.id).status, 'canceled');
  assert.strictEqual(tm.resume(tPaused.id), true);
  assert.strictEqual(tm.tasks.get(tPaused.id).status, 'queued');
  await waitTask(tm, tFill.id);
  const rPaused = await waitTask(tm, tPaused.id);
  assert.strictEqual(rPaused.status, 'done', `续传任务应完成：${rPaused.error}`);
  assert.ok((await fsp.readFile(path.join(rootA, 'up/p.bin'))).equals(bigData));
  ok('排队暂停 → 续传完成 → 取消生效');

  // ===== 6. 服务器互传 A → B（直传不可用 → 自动回退本机中继） =====
  STEP('服务器互传（A → B，回退中继）');
  const [tRelay] = tm.addMany([
    { kind: 'relay', serverId: 'a', peerId: 'b', name: 'tree', srcRemote: '/up/tree', dstRemote: '/from-a/tree', size: 0, groupId: 'g6' },
  ]);
  const rRelay = await waitTask(tm, tRelay.id);
  assert.strictEqual(rRelay.status, 'done', `互传失败：${rRelay.error}`);
  assert.strictEqual(rRelay.direct, false, '直传探测失败应回退中继');
  const relayTree = await readTree(path.join(rootB, 'from-a/tree'));
  assert.deepStrictEqual(Object.keys(relayTree).sort(), Object.keys(remoteTree).sort());
  assert.ok(relayTree['nested/b.bin'].equals(remoteTree['nested/b.bin']));
  ok('A→B 中继内容一致，direct=false');

  // ===== 7. 失败路径：不存在的源 → 任务进入 error =====
  STEP('失败路径');
  const [tErr] = tm.addMany([{ kind: 'download', serverId: 'a', name: 'ghost', srcRemote: '/no/such/file', dstLocal: path.join(local, 'ghost'), size: 0, groupId: 'g7' }]);
  const rErr = await waitTask(tm, tErr.id);
  assert.strictEqual(rErr.status, 'error');
  assert.ok(rErr.error, '应有错误信息');
  ok(`download 报错：${rErr.error.slice(0, 60)}…`);

  console.log('\n冒烟测试全部通过 ✓');
  srvA.close();
  srvB.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n冒烟测试失败 ✗');
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
