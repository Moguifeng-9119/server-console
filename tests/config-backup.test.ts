import { describe, expect, it } from 'vitest';
import { exportPresentationBackup, importPresentationBackup, validatePresentationBackup } from '../src/telemetry/config-backup';

function storage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] || null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe('configuration presentation migration', () => {
  it('exports layout, names and valid appearance settings while excluding secrets and session output', () => {
    expect(exportPresentationBackup(storage({ 'sc.term.layout.host-1': 'columns', 'sc.term.names.host-1': '{"term-1":"Training"}', 'sc.lang': 'zh-CN', 'ssh.password': 'secret', 'sc.term.output.host-1': 'private output' })))
      .toEqual({ 'sc.term.layout.host-1': 'columns', 'sc.term.names.host-1': '{"term-1":"Training"}', 'sc.lang': 'zh-CN' });
  });
  it('rejects injected keys, invalid layouts, oversized names and unsupported settings before applying', () => {
    for (const value of [{ 'ssh.password': 'secret' }, { 'sc.term.layout.host-1': 'script' }, { 'sc.term.names.host-1': JSON.stringify({ term: 'x'.repeat(81) }) }, { 'sc.refreshMs': '1' }]) expect(() => validatePresentationBackup(value)).toThrow();
  });
  it('preserves old settings when storage cannot complete an import', () => {
    const target = storage({ 'sc.lang': 'en' }); const write = target.setItem; let failed = false;
    target.setItem = (key, value) => { if (key === 'sc.theme.user' && !failed) { failed = true; throw new Error('quota'); } write(key, value); };
    expect(() => importPresentationBackup(target, { 'sc.lang': 'zh-CN', 'sc.theme.user': 'dark' })).toThrow('quota');
    expect(target.getItem('sc.lang')).toBe('en'); expect(target.getItem('sc.theme.user')).toBeNull();
  });
});
