const { Worker } = require('node:worker_threads');
const path = require('node:path');

class HistoryStore {
  constructor(directory, onError = (_error) => {}) {
    this.worker = new Worker(path.join(__dirname, 'history-worker.cjs'), { workerData: { directory } });
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
    this.failure = null;
    this.worker.on('message', (message) => {
      if (message.maintenanceError) { onError(new Error(message.maintenanceError)); return; }
      const call = this.pending.get(message.id);
      if (!call) return;
      this.pending.delete(message.id);
      if (message.error) call.reject(new Error(message.error)); else call.resolve(message.data);
    });
    const failed = (error) => {
      this.failure = error;
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear(); onError(error);
    };
    this.worker.on('error', failed);
    this.worker.on('exit', (code) => { if (!this.closed) failed(new Error(`History worker exited (${code})`)); });
  }
  request(method, payload = undefined) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(new Error('History storage is closed'));
    if (this.pending.size >= 256) return Promise.reject(new Error('History storage backlog exceeded'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, payload });
    });
  }
  async close() {
    if (this.closed) return;
    await this.request('close'); this.closed = true;
    await this.worker.terminate();
  }
}
module.exports = { HistoryStore };
