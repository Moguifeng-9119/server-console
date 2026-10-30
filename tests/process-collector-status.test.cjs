import { describe, expect, it } from 'vitest';
import { pollProcesses } from '../electron/monitoring/process-collector.cjs';

describe('GPU process query availability', () => {
  it('keeps system processes when the GPU query failed', async () => {
    const result = await pollProcesses({ exec: async () => ({ code: 0, stdout: 'GPU-1, 123, 100\n__GPU_QUERY_FAILED__\n__PS__\n123 user 1 2 1024 S 01:00 python train.py\n' }) }, new Map([['GPU-1', 0]]));
    expect(result.gpuProcessesAvailable).toBe(false);
    expect(result.processes).toHaveLength(1);
    expect(result.gpuProcs.size).toBe(0);
    expect(result.processes[0].gpu).toBeNull();
  });
  it('marks a successful empty GPU query as available', async () => {
    const result = await pollProcesses({ exec: async () => ({ code: 0, stdout: '__GPU_QUERY_OK__\n__PS__\n' }) });
    expect(result.gpuProcessesAvailable).toBe(true);
  });
  it('rejects a failed system process query', async () => {
    await expect(pollProcesses({ exec: async () => ({ code: 1, stderr: 'ps failed', stdout: '__GPU_QUERY_OK__\n__PS__\n' }) })).rejects.toThrow('ps failed');
  });
});
