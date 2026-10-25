import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommandHistory } from '../electron/cmdhistory.cjs';

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-cmdhist-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('command history', () => {
  it('records newest first, dedupes identical repeats and caps at 200', () => {
    const file = path.join(tmp(), 'command-history.json');
    const h = new CommandHistory({ file, cap: 200 });
    h.record({ command: 'nvidia-smi', servers: ['a', 'b'] });
    h.record({ command: 'ls -la', servers: ['a'] });
    h.record({ command: 'nvidia-smi', servers: ['a', 'b'] }); // 同命令同目标 → 去重置顶
    expect(h.list().map((e) => e.command)).toEqual(['nvidia-smi', 'ls -la']);
    const big = new CommandHistory({ file: path.join(tmp(), 'h2.json'), cap: 200 });
    for (let i = 0; i < 250; i += 1) big.record({ command: 'cmd ' + i, servers: ['a'] });
    const list = big.list();
    expect(list[0].command).toBe('cmd 249');
    const all = new CommandHistory({ file: path.join(tmp(), 'h3.json'), cap: 200 });
    for (let i = 0; i < 250; i += 1) all.record({ command: 'x' + i });
    expect(all.entries).toHaveLength(200);
  });
  it('filters by substring and persists across reloads', () => {
    const file = path.join(tmp(), 'command-history.json');
    const h = new CommandHistory({ file });
    h.record({ command: 'python train.py --epochs 10', servers: ['gpu-1'] });
    h.record({ command: 'nvidia-smi', servers: ['gpu-1', 'gpu-2'] });
    h.record({ command: 'rm -rf /tmp/junk', servers: ['gpu-2'], ok: false });
    expect(h.list('train')).toHaveLength(1);
    expect(h.list('GPU-2')).toHaveLength(2); // 大小写不敏感
    expect(h.list('junk')[0].ok).toBe(false);
    const reloaded = new CommandHistory({ file }).init();
    expect(reloaded.list()).toHaveLength(3);
    expect(reloaded.list()[0].command).toBe('rm -rf /tmp/junk');
  });
  it('removes single entries and clears all', () => {
    const h = new CommandHistory({ file: path.join(tmp(), 'command-history.json') });
    h.record({ command: 'a' });
    h.record({ command: 'b' });
    const first = h.list()[0];
    expect(h.remove(first.id)).toBe(true);
    expect(h.list().map((e) => e.command)).toEqual(['a']);
    h.clear();
    expect(h.list()).toEqual([]);
    expect(h.remove('missing')).toBe(true);
  });
  it('ignores empty commands and truncates huge ones', () => {
    const h = new CommandHistory({ file: path.join(tmp(), 'command-history.json') });
    h.record({ command: '   ' });
    expect(h.list()).toEqual([]);
    h.record({ command: 'x'.repeat(5000) });
    expect(h.list()[0].command.length).toBe(4096);
  });
});
