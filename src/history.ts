import type { HistoryPoint } from './types';

export function normalizeHistory(raw: unknown): HistoryPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is HistoryPoint => !!p && typeof p === 'object'
    && Number.isFinite(p.at) && p.at > 0
    && (p.value === null || (Number.isFinite(p.value) && p.value >= 0 && p.value <= 100)))
    .sort((a, b) => a.at - b.at).filter((p, i, arr) => i === 0 || p.at !== arr[i - 1].at).slice(-720);
}

export function appendSample(points: HistoryPoint[], point: HistoryPoint): HistoryPoint[] {
  if (points[points.length - 1]?.at === point.at) return points;
  return normalizeHistory([...points, point]);
}

export function historySummary(points: HistoryPoint[]) {
  const values = points.flatMap((p) => p.value == null ? [] : [p.value]);
  let weighted = 0, coveredMs = 0;
  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1], now = points[i];
    const duration = now.at - before.at;
    if (before.value == null || now.value == null || duration <= 0 || duration > 60000) continue;
    weighted += ((before.value + now.value) / 2) * duration;
    coveredMs += duration;
  }
  return { average: coveredMs ? weighted / coveredMs : null, coveredMs,
    min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null,
    spanMs: points.length > 1 ? points[points.length - 1].at - points[0].at : 0 };
}
