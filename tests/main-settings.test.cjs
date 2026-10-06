import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import lang from '../electron/lang.cjs';
const directories = [];
afterEach(() => {
  lang.setLanguage('en');
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-main-settings-')); directories.push(root);
  const handlers = new Map(), menus = [];
  const file = path.resolve('electron/main.cjs'), realRequire = createRequire(file);
  const electron = {
    app: { getPath: () => root, getVersion: () => '0.12.1', on() {}, requestSingleInstanceLock: () => false, quit() {} },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
    Tray: class { setContextMenu(menu) { menus.push(menu); } setToolTip() {} on() {} },
    Menu: { buildFromTemplate: (menu) => menu }, nativeImage: { createEmpty: () => ({}), createFromPath: () => ({ resize: () => ({}) }) },
  };
  const context = { require: (name) => name === 'electron' ? electron : name === './ipc.cjs' ? {} : name === './lang.cjs' ? lang : name === './updates.cjs'
      ? { checkUpdate: async () => { throw new Error('HTTP 429'); } } : realRequire(name),
    __dirname: path.dirname(file), process: { platform: process.platform, env: {}, on() {} },
    module: { exports: {} }, console, setTimeout, fetch: async () => ({ ok: false, status: 429 }), AbortSignal };
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports = {loadAppSettings, createTray};', context);
  return { root, handlers, menus, control: context.module.exports };
}
describe('main-process language settings', () => {
  it('does not override system language detection with an unsaved default', () => {
    const f = fixture(); f.control.loadAppSettings();
    expect(f.handlers.get('app:get-settings')().language).toBeUndefined();
  });
  it('restores language before creating the tray and preserves it when close behavior changes', () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.root, 'appsettings.json'), JSON.stringify({ closeAction: 'ask', language: 'de' }));
    f.control.loadAppSettings(); f.control.createTray();
    expect(f.menus.at(-1)[0].label).toBe('Hauptfenster anzeigen');
    f.handlers.get('app:set-settings')(null, { closeAction: 'minimize' });
    expect(JSON.parse(fs.readFileSync(path.join(f.root, 'appsettings.json'), 'utf8'))).toEqual({ closeAction: 'minimize', language: 'de' });
    expect(f.handlers.get('app:get-settings')().language).toBe('de');
  });
  it('refreshes the tray on successful switch and rejects unknown language paths', () => {
    const f = fixture(); f.control.createTray();
    expect(f.handlers.get('app:set-language')(null, 'fr')).toBe(true);
    expect(f.menus.at(-1)[0].label).toBe('Afficher la fenêtre principale');
    expect(f.handlers.get('app:set-language')(null, '../../package')).toBe(false);
    expect(lang.getLanguage()).toBe('fr');
  });
  it('leaves memory and tray unchanged when language persistence fails', () => {
    const f = fixture(); f.control.createTray();
    fs.mkdirSync(path.join(f.root, 'appsettings.json.tmp'));
    expect(() => f.handlers.get('app:set-language')(null, 'de')).toThrow();
    expect(lang.getLanguage()).toBe('en');
    expect(f.menus).toHaveLength(1);
  });
  it('reports API errors as failure through the actual update IPC handler', async () => {
    const f = fixture();
    const result = await f.handlers.get('app:check-update')();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('HTTP 429');
  });
});
