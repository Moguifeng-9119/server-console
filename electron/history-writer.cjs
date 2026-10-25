// One in-flight history transaction. Failed batches remain queued for retry.
class HistoryWriter {
  constructor({ store, onError = (_error) => {}, maxBuckets = 20000 }) {
    this.store = store;
    this.onError = onError;
    this.maxBuckets = maxBuckets;
    this.pending = new Map();
    this.inFlight = null;
    this.closed = false;
  }

  enqueue(buckets) {
    if (this.closed) throw new Error('History writer is closed');
    for (const bucket of buckets) {
      const key = JSON.stringify([bucket.server, bucket.device, bucket.metric, bucket.bucket_at]);
      const previous = this.pending.get(key);
      if (!previous || (bucket.revision || 0) >= (previous.revision || 0)) this.pending.set(key, bucket);
    }
    if (this.pending.size > this.maxBuckets) {
      const overflow = this.pending.size - this.maxBuckets;
      for (let count = 0; count < overflow; count++) this.pending.delete(this.pending.keys().next().value);
      this.onError(new Error(`History backlog exceeded: ${overflow} older buckets could not be saved; affected intervals have incomplete coverage`));
    }
    return this.pump();
  }

  pump() {
    if (this.inFlight) return this.inFlight;
    if (!this.pending.size) return Promise.resolve();
    const batch = [...this.pending.entries()];
    const call = this.store.request('buckets', batch.map(([, value]) => value));
    this.inFlight = call.then(() => {
      for (const [key, value] of batch) if (this.pending.get(key) === value) this.pending.delete(key);
    }).catch((error) => { this.onError(error); }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async close() {
    await this.inFlight;
    for (let attempt = 0; this.pending.size && attempt < 3; attempt++) await this.pump();
    this.closed = true;
    if (this.pending.size) throw new Error(`History shutdown left ${this.pending.size} unsaved buckets`);
  }
}

module.exports = { HistoryWriter };
