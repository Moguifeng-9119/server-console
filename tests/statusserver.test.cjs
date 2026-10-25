import { describe, expect, it, afterEach } from 'vitest';
import http from 'node:http';
import { StatusServer } from '../electron/statusserver.cjs';

const servers = [];
const summary = {
  generatedAt: 1730000000000,
  servers: [{ name: 'alpha', status: 'online', cpu: 12, memUsed: 4e9, memTotal: 32e9, gpus: [{ index: 0, name: 'A100', util: 95, memUsed: 60e9, memTotal: 80e9, temp: 64 }] }],
  transfers: [{ name: 'ckpt.pt', active: true, percent: 42 }],
  events: [{ at: 1730000000000, title: 'rule-triggered', body: 'temperature: 89' }],
};
afterEach(() => { for (const s of servers.splice(0)) s.stop(); });

describe('mobile status page', () => {
  it('serves status.json only with the right token', async () => {
    const s = new StatusServer({ getSummary: () => summary, token: 'sekrit' });
    servers.push(s);
    const { port } = await s.start(0);
    const get = (path) => new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
    });
    const denied = await get('/status.json?token=wrong');
    expect(denied.status).toBe(403);
    const ok = await get('/status.json?token=sekrit');
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).servers[0].gpus[0].util).toBe(95);
    const page = await get('/?token=sekrit');
    expect(page.status).toBe(200);
    expect(page.body).toContain('ServerConsole');
    expect(page.body).toContain('sekrit');
    const missing = await get('/nope?token=sekrit');
    expect(missing.status).toBe(404);
    expect(s.lanAddresses(port).localhost).toContain('token=sekrit');
  });
  it('generates a token when missing and reports running state', async () => {
    const s = new StatusServer({ getSummary: () => summary });
    servers.push(s);
    const { port } = await s.start(0);
    expect(port).toBeGreaterThan(0);
    expect(s.token).toMatch(/^[0-9a-f]{32}$/);
    expect(s.running()).toBe(true);
    s.stop();
    expect(s.running()).toBe(false);
    await expect(s.start(0)).resolves.toMatchObject({ port: expect.any(Number) }); // 可重启
  });
});
