// 开发用假 SSH 服务：本地起一个 sshd，返回假的 nvidia-smi / ps 输出，
// 用来在没有真实 GPU 服务器时验证采集链路。不会打进最终安装包。
//   启动：node scripts/fake-sshd.cjs   （默认 2222 端口，任意用户名密码）
const { Server } = require('ssh2');
const { generateKeyPairSync } = require('node:crypto');
const { readFileSync } = require('node:fs');

const PORT = Number(process.env.FAKE_SSH_PORT || 2222);

function hostKey() {
  try {
    return readFileSync(require('node:os').homedir() + '/.ssh/id_rsa');
  } catch {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    return privateKey;
  }
}

const GPU_CSV = [
  '0, GPU-aaaa, NVIDIA A100-SXM4-80GB, 92, 78320, 81920, 78, 342.5, 71',
  '1, GPU-bbbb, NVIDIA A100-SXM4-80GB, 12, 2048, 81920, 41, 88.0, 34',
  '2, GPU-cccc, NVIDIA A100-SXM4-80GB, 0, 0, 81920, 33, 62.0, 30',
].join('\n');

const APPS_CSV = ['GPU-aaaa, 2311, 40231', 'GPU-aaaa, 2455, 38089', 'GPU-bbbb, 3102, 2048'].join('\n');

const SYS = [
  '3.42 2.98 2.71 2/913 88213',
  '64',
  '               total        used        free      shared  buff/cache   available',
  'Mem:   540587950080 312475783168 201338826752  1073741824 26773340160 224089440256',
  'Swap:  68719476736  2147483648 66571993088',
].join('\n');

const PS = [
  '2311 lin       187.4  3.1 13312000 Rl   03:14:22 python train.py --config configs/llama_7b.yaml',
  '2455 wang       92.1  2.8 12042240 Sl+  01:02:11 python eval.py --ckpt exp42',
  '3102 zhao        0.4  0.1   204800 S    4-02:11:03 python inference_server.py --model qwen2-7b',
  '8899 root        0.0  0.0     5120 Z           00:10 /usr/bin/defunct',
  '9001 ops         0.1  0.0    98304 S    10:02:31 sshd: ops@pts/3',
].join('\n');

function fakeCollect() {
  return `${GPU_CSV}\n__APPS__\n${APPS_CSV}\n__SYS__\n${SYS}\n__PS__\n${PS}\n`;
}

new Server({ hostKeys: [hostKey()] }, (client) => {
  client
    .on('authentication', (ctx) => ctx.accept())
    .on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('exec', (accept, _reject, info) => {
          const stream = accept();
          const cmd = info.command;
          if (/nvidia-smi|__PS__/.test(cmd)) stream.write(fakeCollect());
          else if (/^kill /.test(cmd)) stream.write('');
          else if (/systemctl/.test(cmd)) stream.write('');
          else stream.write('');
          stream.exit(0);
          stream.end();
        });
      });
    })
    .on('error', () => {
      /* noop */
    });
}).listen(PORT, '127.0.0.1', () => console.log(`假 SSH 服务已启动：127.0.0.1:${PORT}`));
