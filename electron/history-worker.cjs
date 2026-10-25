const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const { HistoryDatabase } = require('./history-db.cjs');
const db = new HistoryDatabase(path.join(workerData.directory, 'monitoring.sqlite'));
try { db.migrate(path.join(workerData.directory, 'history.json')); }
catch (error) { parentPort.postMessage({ maintenanceError: 'Legacy history import failed: ' + String(error) }); }
db.cleanup();
const cleanup = setInterval(() => {
  try { db.cleanup(); } catch (error) { parentPort.postMessage({ maintenanceError: String(error) }); }
}, 15 * 60000);
parentPort.on('message', ({ id, method, payload }) => {
  try {
    let data;
    switch (method) {
      case 'snapshot': data = db.snapshot(payload); break;
      case 'gap': data = db.gap(payload.server, payload.at); break;
      case 'query': data = db.query(payload); break;
      case 'load': data = db.legacyLoad(); break;
      case 'save': data = db.legacySave(payload); break;
      case 'cleanup': data = db.cleanup(); break;
      case 'close': clearInterval(cleanup); db.close(); data = true; break;
      default: throw new Error('Unknown history operation');
    }
    parentPort.postMessage({ id, data });
    if (method === 'close') parentPort.close();
  } catch (error) { parentPort.postMessage({ id, error: String(error) }); }
});
