// 最小 shell 回环复现：裸 ssh2 客户端 → fake-sshd shell → 写入命令 → 收回显？
const { Client } = require('ssh2');
const { createFakeSshd } = require('./fake-sshd.cjs');

async function main() {
  const sshd = await createFakeSshd({ port: 0, root: '.' });
  const port = sshd.address().port;
  console.log('sshd on', port);

  const conn = new Client();
  const out = [];
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve).on('error', reject);
    conn.connect({ host: '127.0.0.1', port, username: 'u', password: 'p', readyTimeout: 8000 });
  });
  console.log('connected');

  await new Promise((resolve, reject) => {
    conn.shell({ term: 'xterm-256color', cols: 100, rows: 30 }, (err, stream) => {
      if (err) return reject(err);
      stream.on('data', (d) => {
        out.push(d.toString());
        console.log('[data]', JSON.stringify(d.toString().slice(0, 80)));
      });
      stream.on('close', () => resolve());
      setTimeout(() => {
        console.log('[write] echo sc-marker\\r');
        stream.write('echo sc-marker\r');
      }, 500);
      setTimeout(resolve, 4000);
    });
  });

  const all = out.join('');
  console.log(all.includes('sc-marker') ? 'ROUND TRIP OK' : 'ROUND TRIP FAIL — 服务器回显未到达');
  conn.end();
  sshd.close();
  process.exit(all.includes('sc-marker') ? 0 : 1);
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
