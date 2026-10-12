import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { StreamChannel } from '../electron/monitoring/stream-channel.cjs';

describe('StreamChannel persistent GPU telemetry', () => {
  it('parses streamed lines across arbitrary chunk boundaries', async () => {
    const receivedGpus = [];
    const mockStream = new EventEmitter();
    mockStream.stderr = new EventEmitter();
    mockStream.close = () => mockStream.emit('close', 0);

    const mockConn = {
      connect: async () => {},
      client: {
        exec: (_cmd, cb) => {
          cb(null, mockStream);
        },
      },
    };

    const channel = new StreamChannel({
      connection: mockConn,
      intervalMs: 200,
      onGpus: (gpus) => receivedGpus.push(gpus),
    });

    await channel.start();

    // Stream chunk 1: half of line
    mockStream.emit('data', Buffer.from('0, GPU-STREAM-1, RTX 3090, 60, 8000, 24000, 65,'));
    expect(receivedGpus).toHaveLength(0); // incomplete line

    // Stream chunk 2: rest of line 1 plus newline
    mockStream.emit('data', Buffer.from(' 220, 45\n'));
    expect(receivedGpus).toHaveLength(1);
    expect(receivedGpus[0][0].uuid).toBe('GPU-STREAM-1');
    expect(receivedGpus[0][0].util).toBe(60);

    // Stream chunk 3: line 2 all at once
    mockStream.emit('data', Buffer.from('0, GPU-STREAM-1, RTX 3090, 75, 8200, 24000, 66, 230, 48\n'));
    expect(receivedGpus).toHaveLength(2);
    expect(receivedGpus[1][0].util).toBe(75);

    channel.stop();
  });
});
