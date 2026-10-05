import { describe, it, expect } from 'vitest';
import { freeGiB, matchingGpus } from '../src/resources';
import type { Server } from '../src/types';

describe('GPU resource filtering', () => {
  const server = { name: 'lab', host: 'fixture', status: 'online', processes: [], gpus: [
    { index: 0, name: 'A100', memTotal: 81920, memUsed: 61440, procs: [] },
    { index: 1, name: 'A100', memTotal: 81920, memUsed: 30720, procs: [] },
  ] } as unknown as Server;
  it('uses per-card memory instead of the sum of a server', () => {
    expect(freeGiB(server.gpus[0])).toBe(20);
    expect(matchingGpus(server, 40, '', '').map((g) => g.index)).toEqual([1]);
    expect(matchingGpus(server, 60, '', '')).toHaveLength(0);
  });
  it('excludes offline servers and honors model/search filters', () => {
    expect(matchingGpus({ ...server, status: 'offline' }, 0, '', '')).toEqual([]);
    expect(matchingGpus(server, 0, 'RTX 4090', '')).toEqual([]);
    expect(matchingGpus(server, 0, '', 'LAB')).toHaveLength(2);
  });
});
