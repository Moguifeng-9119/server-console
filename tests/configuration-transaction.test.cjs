import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { ConfigurationTransaction } from '../electron/configuration-transaction.cjs';
const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
describe('configuration import crash recovery', () => {
  it.each([1, 2, 3])('recovers all configuration files after process exit at write boundary %s', (boundary) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-import-crash-')); directories.push(directory);
    const names = ['servers.json', 'workbench.json', 'productivity.json'];
    const originals = [{ servers: [{ id: 'old', password: 'enc:opaque-ciphertext' }] }, { tasks: [], rules: [{ id: 'old' }] }, { workspaces: [{ id: 'old' }] }];
    names.forEach((name, i) => fs.writeFileSync(path.join(directory, name), JSON.stringify(originals[i])));
    const source = `const fs = require('node:fs'), path = require('node:path'); const { ConfigurationTransaction } = require(process.argv[1]); const dir = process.argv[2]; new ConfigurationTransaction(dir).begin('crashed'); const names = ['servers.json','workbench.json','productivity.json']; for(let i=0;i<Number(process.argv[3]);i++) fs.writeFileSync(path.join(dir,names[i]), JSON.stringify({changed:true})); process.exit(42);`;
    const result = spawnSync(process.execPath, ['-e', source, path.resolve('electron/configuration-transaction.cjs'), directory, String(boundary)], { windowsHide: true });
    expect(result.status).toBe(42);
    expect(new ConfigurationTransaction(directory).recover()).toMatchObject({ status: 'pending' });
    for (let i = 0; i < 2; i++) expect(JSON.parse(fs.readFileSync(path.join(directory, names[i]), 'utf8'))).toEqual(originals[i]);
    const productivity = JSON.parse(fs.readFileSync(path.join(directory, names[2]), 'utf8'));
    expect(productivity.workspaces).toEqual(originals[2].workspaces); expect(productivity.importResults[0]).toMatchObject({ operationId: 'crashed', status: 'failed' });
    expect(new ConfigurationTransaction(directory).recover()).toBe(null);
  });
  it('keeps a completed import after its commit marker is durable', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-import-done-')); directories.push(directory);
    const transaction = new ConfigurationTransaction(directory); transaction.begin('done');
    const file = path.join(directory, 'productivity.json'); fs.writeFileSync(file, '{"workspaces":[]}'); transaction.finish();
    expect(transaction.recover()).toBe(null); expect(fs.readFileSync(file, 'utf8')).toBe('{"workspaces":[]}');
  });
});
