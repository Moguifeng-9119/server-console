import type { TransferItem } from './types';

export function formatBytes(n: number | undefined | null, fractionDigits = 1): string {
  const v = Math.max(0, Number(n) || 0);
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v;
  let i = -1;
  do {
    x /= 1024;
    i++;
  } while (x >= 1024 && i < units.length - 1);
  return `${x.toFixed(fractionDigits)} ${units[i]}`;
}

export function formatSpeed(n: number | undefined | null): string {
  if (!n) return '';
  return `${formatBytes(n, 1)}/s`;
}

export function pctOf(t: TransferItem): number {
  if (!t.size) return t.status === 'done' ? 100 : 0;
  return Math.max(0, Math.min(100, (t.transferred / t.size) * 100));
}

export function parentPosix(p: string): string {
  if (!p || p === '/' || p === '.') return '/';
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i);
}

export function joinPosix(dir: string, name: string): string {
  if (!dir || dir === '.') return name;
  return dir.replace(/\/$/, '') + '/' + name;
}

export function fmtTime(ts: number | undefined): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

export function fmtDate(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 秒数 → 人类可读时长（1分20秒 / 1时03分 / 45秒）
export function formatDuration(sec: number | undefined | null): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${String(s % 60).padStart(2, '0')}秒`;
  const h = Math.floor(m / 60);
  return `${h}时${String(m % 60).padStart(2, '0')}分`;
}

// 剩余时间：剩余字节 / 瞬时速度；总量未知返回 null（界面显示“总量统计中”）
export function etaSeconds(t: TransferItem): number | null {
  if (!t.size || t.status !== 'running' || !t.speed) return null;
  const remain = t.size - t.transferred;
  if (remain <= 0) return 0;
  return remain / t.speed;
}
