import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHeadlessMonitor, normalizeConfig, tokenMatches } from '../scripts/headless-monitor.cjs';

describe('opt-in headless monitor', () => {
  it('accepts trusted aliases and rejects option/command injections', () => {
    expect(normalizeConfig({ servers: [{ alias: 'gpu-lab' }] })).toMatchObject({ host: '127.0.0.1', intervalMs: 10000 });
    expect(() => normalizeConfig({ servers: [{ alias: '-oProxyCommand=bad' }] })).toThrow(/alias/);
    expect(() => normalizeConfig({ servers: [{ alias: 'gpu; echo hi' }] })).toThrow(/alias/);
    expect(() => normalizeConfig({ servers: [{ alias: 'a' }, { alias: 'a' }] })).toThrow(/duplicate/);
  });
  it('compares Bearer credentials without accepting query/header alternatives', () => {
    const token = 'a'.repeat(40);
    expect(tokenMatches('Bearer ' + token, token)).toBe(true);
    expect(tokenMatches('Basic ' + token, token)).toBe(false);
    expect(tokenMatches('Bearer wrong', token)).toBe(false);
  });
  it('requires authentication, provides read-only history, and persists samples', async () => {
    const history = { request: vi.fn(async () => ({ points: [] })), close: vi.fn(async () => {}) };
    const collect = vi.fn(async () => ({ gpus: [{ index: 0, uuid: 'gpu-1', util: 25, memUsed: 100, memTotal: 200 }], system: '0.0 0.0 0.0\n4\nMem: 1000 500\n__CPU__\ncpu 1 0 1 8' }));
    const token = 'a'.repeat(40), monitor = await createHeadlessMonitor({ config: { port: 0, servers: [{ alias: 'lab', id: 's1' }] }, directory: '', token, collect, history });
    const url = 'http://127.0.0.1:' + monitor.server.address().port;
    try {
      expect((await fetch(url + '/api/servers')).status).toBe(401);
      expect((await fetch(url + '/api/servers?token=' + token)).status).toBe(401);
      const headers = { authorization: 'Bearer ' + token };
      expect((await fetch(url + '/api/servers', { headers, method: 'POST' })).status).toBe(405);
      const servers = await (await fetch(url + '/api/servers', { headers })).json();
      expect(servers[0]).toMatchObject({ id: 's1', status: 'online' });
      await fetch(url + '/api/history?serverId=s1&rangeMs=3600000', { headers });
      expect(history.request).toHaveBeenCalledWith('query', expect.objectContaining({ serverId: 's1', rangeMs: 3600000 }));
      expect((await fetch(url + '/api/history?serverId=s1&rangeMs=500', { headers })).status).toBe(400);
      expect(history.request).toHaveBeenCalledWith('snapshot', expect.objectContaining({ id: 's1' }));
    } finally { await monitor.close(); }
    expect(history.close).toHaveBeenCalledOnce();
  });
  it('serves observations written by the real SQLite worker', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-headless-history-'));
    const token = 'b'.repeat(40);
    const collect = async () => ({ gpus: [{ index: 0, uuid: 'gpu-real', name: 'Test GPU', util: 37, memUsed: 100, memTotal: 200, procs: [] }], system: '0.0 0.0 0.0\n4\nMem: 1000 500\n__CPU__\ncpu 1 0 1 8' });
    let monitor;
    try {
      monitor = await createHeadlessMonitor({ config: { port: 0, servers: [{ alias: 'lab', id: 's1' }] }, directory, token, collect });
      const url = 'http://127.0.0.1:' + monitor.server.address().port;
      const response = await fetch(url + '/api/history?serverId=s1&device=gpu%3Agpu-real&metric=util&rangeMs=3600000', { headers: { authorization: 'Bearer ' + token } });
      expect(response.status).toBe(200); const history = await response.json();
      expect(history.points.some((point) => point.value === 37)).toBe(true);
      expect(fs.existsSync(path.join(directory, 'monitoring.sqlite'))).toBe(true);
    } finally { if (monitor) await monitor.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  });
});
