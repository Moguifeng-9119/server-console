// Each channel owns only its SSH exec stream; terminal/transfer connections stay alive.
const { StringDecoder } = require('node:string_decoder');
const { parseGpuCsv } = require('./gpu-poller.cjs');

class StreamChannel {
  constructor({ connection = null, intervalMs = 500, onGpus = (_gpus) => {}, onError = (_err) => {},
    idleTimeoutMs = 6000, maxBufferBytes = 65536, now = Date.now } = {}) {
    this.connection = connection; this.intervalMs = intervalMs; this.onGpus = onGpus; this.onError = onError;
    this.idleTimeoutMs = idleTimeoutMs; this.maxBufferBytes = maxBufferBytes; this.now = now;
    this.stream = null; this.active = false; this.buffer = ''; this.lastDataAt = 0;
    this.idleChecker = null; this.generation = 0; this.stderr = ''; this.decoder = new StringDecoder('utf8');
  }
  async start() {
    if (this.active) return;
    this.active = true; this.buffer = ''; this.stderr = ''; this.decoder = new StringDecoder('utf8');
    this.lastDataAt = this.now(); const generation = ++this.generation;
    const valid = () => this.active && generation === this.generation;
    const interval = Math.max(200, Math.min(10000, Math.round(Number(this.intervalMs) || 500)));
    // exec replaces the shell so a TERM targets nvidia-smi, never unrelated processes.
    const cmd = 'exec nvidia-smi -lms ' + interval + ' --query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed --format=csv,noheader,nounits';
    const fail = (error) => {
      if (!valid()) return;
      this.stop();
      this.onError(error instanceof Error ? error : new Error(String(error)));
    };
    try {
      await this.connection.connect();
      if (!valid()) return;
      await new Promise((resolve, reject) => {
        this.connection.client.exec(cmd, (error, stream) => {
          if (error) { reject(error); return; }
          if (!valid()) { try { stream.close(); } catch { /* channel already closed */ } resolve(); return; }
          this.stream = stream;
          stream.on('data', (chunk) => {
            if (!valid()) return;
            this.buffer += this.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            let index;
            while ((index = this.buffer.indexOf('\n')) >= 0) {
              if (Buffer.byteLength(this.buffer.slice(0, index)) > this.maxBufferBytes) { fail(new Error('GPU stream line exceeded limit')); return; }
              const line = this.buffer.slice(0, index).trim(); this.buffer = this.buffer.slice(index + 1);
              if (!line) continue;
              const gpus = parseGpuCsv(line);
              if (gpus.length) {
                this.lastDataAt = this.now();
                try { this.onGpus(gpus); } catch (callbackError) { fail(callbackError); return; }
              }
            }
            if (Buffer.byteLength(this.buffer) > this.maxBufferBytes) fail(new Error('GPU stream buffer exceeded limit'));
          });
          stream.stderr?.on('data', (chunk) => { if (valid()) this.stderr = (this.stderr + chunk.toString()).slice(-4096); });
          stream.on('error', fail);
          stream.on('close', (code, signal) => {
            if (!valid()) return;
            fail(new Error('GPU stream closed (' + (signal || (code ?? 'unknown')) + ')' + (this.stderr ? ': ' + this.stderr.trim() : '')));
          });
          this.idleChecker = setInterval(() => {
            if (valid() && this.now() - this.lastDataAt > this.idleTimeoutMs) fail(new Error('GPU stream idle timeout'));
          }, Math.min(1000, this.idleTimeoutMs));
          this.idleChecker.unref?.();
          resolve();
        });
      });
    } catch (error) { fail(error); }
  }
  stop() {
    this.active = false; this.generation++;
    if (this.idleChecker) clearInterval(this.idleChecker);
    this.idleChecker = null;
    const stream = this.stream; this.stream = null;
    if (stream) {
      try { stream.signal?.('TERM'); } catch { /* peer may already have exited */ }
      try { stream.close(); } catch { /* peer may already have exited */ }
    }
    this.buffer = ''; this.stderr = '';
  }
}
module.exports = { StreamChannel };
