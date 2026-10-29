import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeChecksums } from '../scripts/release-checksums.cjs';
import { checkInstallUpgrade } from '../scripts/install-upgrade-check.cjs';

const directories = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-checksum-')); directories.push(directory);
  const name = 'ServerConsole-Setup-0.18.0.exe', content = Buffer.from('test installer bytes');
  fs.writeFileSync(path.join(directory, name), content);
  fs.writeFileSync(path.join(directory, 'latest.yml'), `version: 0.18.0\nfiles:\n  - url: ${name}\n    sha512: ${crypto.createHash('sha512').update(content).digest('base64')}\n    size: ${content.length}\n`);
  return { directory, name };
}
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
describe('release integrity tooling', () => {
  it('checks update hashes then writes checksum names matching actual downloads', async () => {
    const { directory, name } = fixture();
    expect(await writeChecksums(directory, '0.18.0')).toContain(name);
    expect(fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8')).toMatch(new RegExp('[a-f0-9]{64}  ' + name));
  });
  it('rejects tampered installers and missing metadata targets', async () => {
    const { directory, name } = fixture(); fs.appendFileSync(path.join(directory, name), 'tampered');
    await expect(writeChecksums(directory, '0.18.0')).rejects.toThrow(/SHA-512/);
    fs.unlinkSync(path.join(directory, name)); fs.writeFileSync(path.join(directory, 'other-0.18.0.exe'), 'x');
    await expect(writeChecksums(directory, '0.18.0')).rejects.toThrow(/missing or renamed/);
  });
  it('refuses installer mutation outside an isolated CI runner', async () => {
    if (process.env.GITHUB_ACTIONS === 'true' && process.platform === 'win32') return;
    await expect(checkInstallUpgrade()).rejects.toThrow(/only in an isolated/);
  });
});
