const { parentPort } = require('node:worker_threads');

parentPort.once('message', ({ lines, patterns, mode, trackLoss }) => {
  const matchers = mode === 'literal' ? patterns : patterns.map((pattern) => new RegExp(pattern));
  const hitIndices = [], progress = [];
  for (const [index, line] of lines.entries()) {
    if (matchers.some((matcher) => typeof matcher === 'string' ? line.includes(matcher) : matcher.test(line))) hitIndices.push(index);
    if (trackLoss) {
      const match = (name) => { const found = line.match(new RegExp('(?:^|[\\s,;])' + name + '[=:\\s]+([0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)', 'i')); return found && Number.isFinite(+found[1]) ? +found[1] : null; };
      const loss = match('loss'), step = match('step'), epoch = match('epoch');
      if (loss !== null || step !== null || epoch !== null) progress.push({ loss, step, epoch });
    }
  }
  parentPort.postMessage({ hitIndices, progress });
});
