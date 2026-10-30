import { describe, expect, it } from 'vitest';
import { parseTrainingLines } from '../src/research/training-parser';
const now = Date.now();
describe('training log adapters', () => {
  it('normalizes Python fractional Unix seconds to integer milliseconds', () => {
    const result = parseTrainingLines([JSON.stringify({ timestamp: now / 1000 - 0.0001, step: 1, loss: 0.3 })], now);
    expect(result.points.every((p) => Number.isSafeInteger(p.at))).toBe(true); expect(result.points[0].at).toBeLessThanOrEqual(now);
  });
  it('parses JSONL including validation metrics, rate and explicit step totals', () => {
    const result = parseTrainingLines([JSON.stringify({ step: 5, epoch: 0.5, total_steps: 20, metrics: { loss: 0.3, eval_loss: 0.4, learning_rate: 0.0001, train_samples_per_second: 25 } })], now);
    expect(Object.fromEntries(result.points.map((p) => [p.name, p.value]))).toEqual({ step: 5, epoch: 0.5, total_steps: 20, loss: 0.3, val_loss: 0.4, lr: 0.0001, samples_per_second: 25 });
    expect(result.points.every((p) => p.step === 5)).toBe(true);
  });
  it('parses common text and preserves negative finite observations', () => {
    const result = parseTrainingLines(['step 10/50 epoch: 1 loss=-0.2 lr=1e-5 tokens_per_second=200'], now);
    expect(result.points.find((p) => p.name === 'total_steps')?.value).toBe(50); expect(result.points.find((p) => p.name === 'loss')?.value).toBe(-0.2);
  });
  it('records NaN as a missing metric with evidence rather than zero', () => {
    const result = parseTrainingLines(['step=2 loss=NaN', '{"loss":"Infinity","step":3}', 'CUDA out of memory. Tried to allocate 2 GiB'], now);
    expect(result.points.filter((p) => p.name === 'loss').map((p) => p.value)).toEqual([null, null]); expect(result.events.map((e) => e.kind)).toEqual(['nan', 'nan', 'oom']);
  });
  it('accepts Python JSON NaN without changing quoted message strings', () => {
    const result = parseTrainingLines(['{"step":2,"loss":NaN,"message":"text: NaN, remains text"}', '{"metrics":{"dice":0.8,"val/miou":0.7},"time":12.3}'], now);
    expect(result.events[0].kind).toBe('nan'); expect(result.points.find((p) => p.name === 'loss')?.value).toBeNull();
    expect(result.points.find((p) => p.name === 'dice')?.value).toBe(0.8); expect(result.points.find((p) => p.name === 'val/miou')?.at).toBe(now);
  });
  it('does not infer observations from malformed JSON or future timestamps', () => {
    const result = parseTrainingLines(['{"loss":0.2', JSON.stringify({ loss: 0.3, timestamp: now + 86400000 })], now);
    expect(result.points).toHaveLength(1); expect(result.points[0].at).toBe(now); expect(result.points[0].step).toBe(null);
  });
  it('retains repeated steps and separates complete line identities', () => {
    const result = parseTrainingLines(['step=2 loss=0.4', 'step=2 loss=0.3'], now);
    expect(result.points.filter((p) => p.name === 'loss').map((p) => p.line)).toEqual([0, 1]);
  });
});
