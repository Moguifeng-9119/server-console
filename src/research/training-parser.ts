export type ParsedPoint = { line: number; name: string; value: number | null; step: number | null; at: number };
export type TrainingEvidence = { line: number; kind: 'oom' | 'nan'; at: number; evidence: string };
export type ParsedTraining = { points: ParsedPoint[]; events: TrainingEvidence[] };
const aliases: Record<string, string> = { learning_rate: 'lr', learningrate: 'lr', val_loss: 'val_loss', eval_loss: 'val_loss', train_loss: 'loss', train_accuracy: 'accuracy', eval_accuracy: 'val_accuracy', validation_accuracy: 'val_accuracy', samples_per_second: 'samples_per_second', train_samples_per_second: 'samples_per_second', tokens_per_second: 'tokens_per_second', total_step: 'total_steps' };
const known = new Set(['loss', 'val_loss', 'accuracy', 'val_accuracy', 'lr', 'throughput', 'samples_per_second', 'tokens_per_second', 'step', 'epoch', 'total_steps']);
const metricName = (key: string) => { const normalized = key.toLowerCase().replace(/^train[/.]/, '').replace(/^(?:eval|validation)[/.]/, 'val_'); return aliases[normalized] || normalized; };
const numeric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;

function normalizeNonFiniteJson(input: string): string {
  let quoted = false, escaped = false, previous = '', output = '';
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) { output += char; if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') { quoted = false; previous = '"'; } continue; }
    if (char === '"') { quoted = true; output += char; continue; }
    if ([':', '[', ','].includes(previous) && /[NI+\-n]/.test(char)) {
      const token = /^(?:nan|[-+]?inf(?:inity)?)(?=\s*[,}\]])/i.exec(input.slice(index));
      if (token) { output += JSON.stringify(token[0]); index += token[0].length - 1; previous = '"'; continue; }
    }
    output += char; if (!/\s/.test(char)) previous = char;
  }
  return output;
}

/** Adapters parse complete JSONL records and common key=value training text. */
export function parseTrainingLines(lines: string[], observedAt: number): ParsedTraining {
  const points: ParsedPoint[] = [], events: TrainingEvidence[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].slice(0, 65536), metrics: Record<string, unknown> = {};
    let at = observedAt;
    if (line.trimStart().startsWith('{')) {
      try {
        const record: unknown = JSON.parse(normalizeNonFiniteJson(line));
        if (record && typeof record === 'object' && !Array.isArray(record)) {
          const row = record as Record<string, unknown>;
          const nested = row.metrics && typeof row.metrics === 'object' && !Array.isArray(row.metrics) ? row.metrics as Record<string, unknown> : {};
          for (const [key, value] of Object.entries({ ...row, ...nested })) {
            const name = metricName(key);
            if (/^[a-z][a-z0-9_./-]{0,79}$/.test(name) && !/^(?:time|timestamp|timestamp_ms|pid|rank|local_rank|world_size|gpu|gpu_index)$/.test(name) && !/password|secret|credential|api.?key|access.?key|private.?key|(?:^|_)token$/.test(name)) metrics[name] = value;
          }
          const timestamp = row.timestamp ?? (typeof row.time === 'number' && row.time < 1000000000 ? undefined : row.time);
          const parsedAt = typeof timestamp === 'string' ? Date.parse(timestamp) : typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp < 100000000000 ? timestamp * 1000 : timestamp : NaN;
          if (Number.isFinite(parsedAt) && parsedAt >= 0 && parsedAt <= observedAt + 60000) at = Math.trunc(parsedAt);
        }
      } catch { /* Incomplete/invalid JSONL records are not observations. */ }
    } else {
      const pattern = /\b(loss|val_loss|eval_loss|train_loss|accuracy|eval_accuracy|val_accuracy|lr|learning_rate|throughput|samples_per_second|tokens_per_second|step|epoch|total_steps)\b[=:\s]+([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|nan|[-+]?inf(?:inity)?)/gi;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line))) metrics[metricName(match[1])] = match[2];
      const total = line.match(/\bstep[=:\s]+\d+\s*\/\s*(\d+)/i); if (total) metrics.total_steps = total[1];
    }
    const rawStep = numeric(metrics.step), step = rawStep !== null && rawStep >= 0 ? rawStep : null;
    let hasNan = false;
    for (const [name, raw] of Object.entries(metrics)) {
      const value = numeric(raw);
      if (['step', 'epoch'].includes(name) && value !== null && value < 0) continue;
      if (value !== null && (name !== 'total_steps' || Number.isSafeInteger(value) && value > 0)) points.push({ line: index, name, value, step, at });
      else if (raw === null && known.has(name)) points.push({ line: index, name, value: null, step, at });
      else if (typeof raw === 'string' && /^(?:nan|[-+]?inf(?:inity)?)$/i.test(raw)) { hasNan = true; points.push({ line: index, name, value: null, step, at }); }
    }
    if (hasNan) events.push({ line: index, kind: 'nan', at, evidence: line.slice(0, 1500) });
    if (/\b(?:CUDA\s+)?out of memory\b|\bOutOfMemoryError\b/i.test(line)) events.push({ line: index, kind: 'oom', at, evidence: line.slice(0, 1500) });
  }
  return { points, events };
}
