import { describe, it, expect } from 'vitest';
import { formatBytes, formatSpeed, formatDuration, etaSeconds, pctOf, parentPosix, joinPosix, fmtDate, fmtTime } from '../src/format';

describe('formatBytes', () => {
  it('basic units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB');
  });

  it('clamps at last unit and handles bad input', () => {
    expect(formatBytes(1024 ** 5)).toBe('1024.0 TB');
    expect(formatBytes(undefined)).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });

  it('fractionDigits', () => {
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });
});

describe('formatSpeed', () => {
  it('empty for 0/undefined', () => {
    expect(formatSpeed(0)).toBe('');
    expect(formatSpeed(undefined)).toBe('');
  });
  it('appends /s', () => {
    expect(formatSpeed(2048)).toBe('2.0 KB/s');
  });
});

describe('formatDuration', () => {
  it('seconds/minutes/hours', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(45, 'zh-CN')).toBe('45秒');
    expect(formatDuration(83, 'ja')).not.toMatch(/秒|分/);
    expect(formatDuration(60)).toBe('1m 0s');
    expect(formatDuration(83)).toBe('1m 23s');
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(3725)).toBe('1h 2m');
  });
  it('bad input', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(undefined)).toBe('0s');
    expect(formatDuration(-10)).toBe('0s');
  });
});

describe('pctOf', () => {
  it('known size', () => {
    expect(pctOf({ size: 200, transferred: 50 })).toBe(25);
  });
  it('unknown size: done=100, running=0', () => {
    expect(pctOf({ size: 0, status: 'done' })).toBe(100);
    expect(pctOf({ size: 0, status: 'running' })).toBe(0);
  });
  it('clamps to 0..100', () => {
    expect(pctOf({ size: 10, transferred: 99 })).toBe(100);
    expect(pctOf({ size: 10, transferred: -5 })).toBe(0);
  });
});

describe('etaSeconds', () => {
  it('remaining bytes / speed', () => {
    expect(etaSeconds({ size: 1000, transferred: 500, speed: 100, status: 'running' })).toBe(5);
  });
  it('null when not running / no size / no speed', () => {
    expect(etaSeconds({ size: 1000, transferred: 0, speed: 0, status: 'running' })).toBe(null);
    expect(etaSeconds({ size: 0, transferred: 0, speed: 100, status: 'running' })).toBe(null);
    expect(etaSeconds({ size: 1000, transferred: 0, speed: 100, status: 'paused' })).toBe(null);
  });
  it('zero when complete', () => {
    expect(etaSeconds({ size: 100, transferred: 100, speed: 10, status: 'running' })).toBe(0);
  });
});

describe('posix path helpers', () => {
  it('parentPosix', () => {
    expect(parentPosix('/a/b')).toBe('/a');
    expect(parentPosix('/a')).toBe('/');
    expect(parentPosix('/')).toBe('/');
    expect(parentPosix('')).toBe('/');
    expect(parentPosix('.')).toBe('/');
    expect(parentPosix('/a/b/c.txt')).toBe('/a/b');
  });
  it('joinPosix', () => {
    expect(joinPosix('/', 'x')).toBe('/x');
    expect(joinPosix('/a/', 'b')).toBe('/a/b');
    expect(joinPosix('', 'b')).toBe('b');
    expect(joinPosix('.', 'b')).toBe('b');
    expect(joinPosix('/a', '.hidden')).toBe('/a/.hidden');
  });
});

describe('time format', () => {
  it('fmtDate/fmtTime empty for falsy', () => {
    expect(fmtDate(0)).toBe('');
    expect(fmtDate(undefined)).toBe('');
    expect(fmtTime(0)).toBe('');
  });
  it('fmtDate pads fields', () => {
    expect(fmtDate(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026-01-02 03:04');
  });
});
