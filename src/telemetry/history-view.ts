import type { HistoryResult } from '../types';

export const seriesColors = ['#2877d4', '#079980', '#9866d1', '#c78420', '#cf5d8c', '#56736b', '#4594ba', '#9a7946'];
export function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  // Spreadsheet formulas can be present in imported server names or labels.
  return `"${(/^[=+@-]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"`;
}
export function historyCsv(series: Array<{ label: string; data: HistoryResult }>, metric: string, start: number, end: number) {
  const rows: unknown[][] = [['device', 'metric', 'timestamp_utc', 'mean', 'min', 'max', 'covered_ms', 'gap']];
  for (const item of series) for (const p of item.data.points) {
    if (p.at < start || p.at >= end) continue;
    rows.push([item.label, metric, new Date(p.at).toISOString(), p.value, p.min, p.max, p.coveredMs, p.gap]);
  }
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
export function summarizeHistory(data: HistoryResult, start: number, end: number) {
  let integral = 0, coveredMs = 0, min: number | null = null, max: number | null = null;
  for (const p of data.points) {
    if (p.at < start || p.at >= end || p.value == null) continue;
    integral += p.value * p.coveredMs;
    coveredMs += p.coveredMs;
    min = Math.min(min ?? Infinity, p.min ?? p.value);
    max = Math.max(max ?? -Infinity, p.max ?? p.value);
  }
  return { average: coveredMs ? integral / coveredMs : null, min, max, coverage: Math.min(1, coveredMs / Math.max(1, end - start)) };
}
export function downloadText(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
