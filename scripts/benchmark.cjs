// A reproducible loopback benchmark. All GPU values come from fake-sshd.
// Use measured results only for local SSH/renderer planning, not GPU/production performance claims.
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { createFakeSshd } = require('./fake-sshd.cjs');
const { Pool } = require('../electron/ssh.cjs');

async function sample(count, hostKeyBuf) {
  const taskDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sc-benchmark-'));
  const pool = new Pool();
  const servers = [];
  const delay = monitorEventLoopDelay({resolution: 10});
  delay.enable();
  try {
    for (let i = 0; i < count; i++) servers.push(await createFakeSshd({port: 0, root: path.join(taskDir, String(i)), hostKeyBuf}));
    const configs = servers.map((server, i) => ({id: 'benchmark-' + i,host: '127.0.0.1',port: server.address().port,username: 'fixture',password: 'fixture',authType: 'password'}));
    const collect = () => Promise.all(configs.map((config) => pool.get(config).collect()));
    const coldStart = performance.now(); await collect();
    const coldMs = performance.now() - coldStart;
    const timings = [], payloads = [];
    for (let round = 0; round < 5; round++) {
      const start = performance.now(); const snapshots = await collect();
      timings.push(performance.now() - start);
      payloads.push(snapshots.reduce((bytes, snap) => bytes + Buffer.byteLength(JSON.stringify(snap)), 0));
    }
    timings.sort((a,b) => a-b);
    return {servers: count,rounds: 5,coldConnectAndCollectMs: +coldMs.toFixed(2),warmCollectMedianMs: +timings[2].toFixed(2),warmCollectMaxMs: +timings[4].toFixed(2),snapshotBytesPerFleetRound: Math.round(payloads.reduce((a,b) => a+b,0)/payloads.length),nodeRssMiB: +(process.memoryUsage().rss/1048576).toFixed(2),eventLoopP99Ms: +(delay.percentile(99)/1e6).toFixed(2)};
  } finally {
    delay.disable();
    for (const id of [...pool.conns.keys()]) pool.remove(id);
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    // Verified task-owned temp directory; never a user input path.
    if (path.dirname(taskDir) === os.tmpdir() && path.basename(taskDir).startsWith('sc-benchmark-')) await fsp.rm(taskDir, {recursive: true, force: true});
  }
}

async function main() {
  const {privateKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048,privateKeyEncoding: {type: 'pkcs1',format: 'pem'},publicKeyEncoding: {type: 'pkcs1',format: 'pem'}});
  const result = {at: new Date().toISOString(),scope:'Synthetic loopback SSH, real transport, simulated GPU/ps metrics. Node includes fake servers and clients; no Electron renderer.',environment:{platform:process.platform,arch:process.arch,node:process.version,cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model},results:[]};
  for (const count of [10,30]) { const row=await sample(count,Buffer.from(privateKey));result.results.push(row);console.log(JSON.stringify(row)); }
  const output = path.resolve(process.env.SC_BENCHMARK_OUTPUT || path.join(__dirname,'../test-artifacts/benchmark.json'));
  await fsp.mkdir(path.dirname(output), {recursive:true});await fsp.writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('Saved '+output);
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
