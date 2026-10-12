// Persistent stream channel for nvidia-smi -lms continuous telemetry
const { parseGpuCsv } = require('./gpu-poller.cjs');

class StreamChannel {
  constructor({
    connection = null,
    intervalMs = 500,
    onGpus = (_gpus) => {},
    onError = (_err) => {},
    idleTimeoutMs = 6000,
    now = Date.now,
  } = {}) {
    this.connection = connection;
    this.intervalMs = intervalMs;
    this.onGpus = onGpus;
    this.onError = onError;
    this.idleTimeoutMs = idleTimeoutMs;
    this.now = now;

    this.stream = null;
    this.active = false;
    this.buffer = '';
    this.lastDataAt = 0;
    this.idleChecker = null;
  }

  async start() {
    if (this.active) return;
    this.active = true;
    this.buffer = '';
    this.lastDataAt = this.now();

    const cmd = `nvidia-smi -lms ${Math.max(100, this.intervalMs)} --query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed --format=csv,noheader,nounits 2>/dev/null`;

    try {
      await this.connection.connect();
      if (!this.active) return;

      this.connection.client.exec(cmd, (err, stream) => {
        if (err) {
          this.active = false;
          this.onError(err);
          return;
        }
        if (!this.active) {
          try { stream.close(); } catch { /* noop */ }
          return;
        }

        this.stream = stream;

        stream.on('data', (chunk) => {
          this.lastDataAt = this.now();
          this.buffer += chunk.toString('utf8');

          let idx;
          while ((idx = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, idx).trim();
            this.buffer = this.buffer.slice(idx + 1);
            if (line) {
              const gpus = parseGpuCsv(line);
              if (gpus.length > 0) {
                this.onGpus(gpus);
              }
            }
          }
        });

        stream.stderr.on('data', (_errChunk) => {
          /* ignore standard nvidia-smi warnings */
        });

        stream.on('close', (code) => {
          this.active = false;
          this.stream = null;
          if (this.idleChecker) clearInterval(this.idleChecker);
          if (code !== 0 && code !== undefined) {
            this.onError(new Error(`Stream exited with code ${code}`));
          }
        });
      });

      // Periodic check for idle / hung streams
      this.idleChecker = setInterval(() => {
        if (this.active && this.now() - this.lastDataAt > this.idleTimeoutMs) {
          this.stop();
          this.onError(new Error('Stream idle timeout'));
        }
      }, 2000);
    } catch (err) {
      this.active = false;
      this.onError(err);
    }
  }

  stop() {
    this.active = false;
    if (this.idleChecker) {
      clearInterval(this.idleChecker);
      this.idleChecker = null;
    }
    if (this.stream) {
      try {
        this.stream.close();
      } catch {
        /* noop */
      }
      this.stream = null;
    }
    this.buffer = '';
  }
}

module.exports = {
  StreamChannel,
};
