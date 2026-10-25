import { describe, expect, it } from 'vitest';
import { PollScheduler } from '../electron/poll-scheduler.cjs';
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
describe('independent monitoring scheduling', () => {
  it('a hanging host does not block repeated collection of a healthy host', async () => {
    let now = 10000, release;
    const calls = [];
    const poll = new PollScheduler({ configs: () => [{ id: 'slow' }, { id: 'fast' }], interval: () => 2000, now: () => now,
      collect: (cfg) => { calls.push(cfg.id); return cfg.id === 'slow' ? new Promise((r) => { release = r; }) : Promise.resolve(); } });
    poll.tick(); await settle(); now += 2000; poll.tick(); await settle();
    expect(calls).toEqual(['slow', 'fast', 'fast']); release(); await settle(); poll.stop();
  });
  it('focus forces an immediate collection without duplicate pending channels', async () => {
    let now = 10000, release;
    const calls = [];
    const poll = new PollScheduler({ configs: () => [{ id: 'a' }, { id: 'b' }], interval: () => 2000, now: () => now,
      collect: (cfg) => { calls.push(cfg.id); return cfg.id === 'b' ? new Promise((r) => { release = r; }) : Promise.resolve(); } });
    poll.focus('a'); await settle(); now += 300; poll.focus('b'); poll.focus('b'); await settle();
    expect(calls.filter((id) => id === 'b')).toHaveLength(1);
    release(); await settle(); now += 300; poll.focus('b'); await settle();
    expect(calls.filter((id) => id === 'b')).toHaveLength(2); release(); await settle(); poll.stop();
  });
});
