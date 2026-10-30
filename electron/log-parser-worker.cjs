const { parentPort } = require('node:worker_threads');
const { parseTrainingLines } = require('./generated/training-parser.js');
const crypto = require('node:crypto');

parentPort.once('message', async ({ lines, patterns, mode, trackLoss, context }) => {
  const matchers = mode === 'literal' ? patterns : patterns.map((pattern) => new RegExp(pattern));
  const hitIndices = [], progress = [];
  for (const [index, line] of lines.entries()) {
    if (matchers.some((matcher) => typeof matcher === 'string' ? line.includes(matcher) : matcher.test(line))) hitIndices.push(index);
  }
  const training = trackLoss ? parseTrainingLines(lines, Date.now()) : { points: [], events: [] };
  const records = new Map();
  for (const point of training.points) if (['loss', 'step', 'epoch'].includes(point.name)) {
    const record = records.get(point.line) || { loss: null, step: null, epoch: null };
    record[point.name] = point.value; records.set(point.line, record);
  }
  progress.push(...[...records.values()].slice(-120));
  if (context) {
    let offset = context.base;
    const sourceIds = context.raw.split('\n').slice(0, lines.length).map((raw) => { const id = context.identity + ':' + offset + ':' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16); offset += Buffer.byteLength(raw, 'utf8') + 1; return id; });
    const points = training.points.map(({ line, ...point }) => ({ ...point, source: context.source, sourceId: sourceIds[line] })), events = training.events.map(({ line, ...event }) => ({ ...event, sourceId: sourceIds[line] }));
    for (let i = 0; i < Math.max(points.length / 8000, events.length / 500); i++) {
      const acknowledged = new Promise((resolve) => parentPort.once('message', resolve));
      parentPort.postMessage({ type: 'training', points: points.slice(i * 8000, (i + 1) * 8000), events: events.slice(i * 500, (i + 1) * 500) });
      await acknowledged;
    }
  }
  parentPort.postMessage({ hitIndices: hitIndices.slice(-20), progress });
});
