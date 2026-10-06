import { afterEach, describe, expect, it } from 'vitest';
import lang from '../electron/lang.cjs';
afterEach(() => lang.setLanguage('en'));
describe('shared native translations', () => {
  for (const language of lang.languages) {
    it(`${language} localizes errors, tray and notifications from the shared catalog`, () => {
      expect(lang.setLanguage(language)).toBe(true);
      for (const key of ['trayShow', 'trayQuit', 'timeout', 'permission', 'serverMissing']) {
        expect(lang.t(key)).not.toBe(key);
        if (!['zh-CN', 'zh-TW', 'ja'].includes(language)) expect(lang.t(key)).not.toMatch(/[\u4e00-\u9fff]/);
      }
      expect(lang.t('commandFailed', { code: 5, detail: 'REMOTE {{code}}' })).toContain('REMOTE {{code}}');
      expect(lang.t('done', { name: 'fixture' })).toContain('fixture');
    });
  }
  it('rejects arbitrary file paths and retains the selected language', () => {
    lang.setLanguage('de'); expect(lang.setLanguage('../package')).toBe(false);
    expect(lang.getLanguage()).toBe('de');
  });
});
