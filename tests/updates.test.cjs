import { describe, expect, it, vi } from 'vitest';
import { checkUpdate } from '../electron/updates.cjs';

const release = (tag) => ({ tag_name: tag, html_url: 'https://github.com/Moguifeng-9119/server-console/releases/tag/' + tag, draft: false, prerelease: false });
const response = (data) => vi.fn(async () => ({ ok: true, status: 200, json: async () => data }));

describe('update checks', () => {
  it.each([403, 404, 429, 500])('rejects HTTP %s instead of reporting up to date', async (status) => {
    const json = vi.fn(async () => ({ message: 'API error' }));
    await expect(checkUpdate('0.12.1', vi.fn(async () => ({ ok: false, status, json })))).rejects.toThrow(String(status));
    expect(json).not.toHaveBeenCalled();
  });
  it.each([null, {}, { tag_name: '' }, release('v0.12.x'), release('v0.12.2-beta'), { ...release('v0.12.2'), draft: true }, { ...release('v0.12.2'), prerelease: true }, { ...release('v0.12.2'), html_url: 'https://example.com' }])('rejects malformed or untrusted release data %#', async (data) => {
    await expect(checkUpdate('0.12.1', response(data))).rejects.toThrow();
  });
  it.each([['v0.12.1', false], ['v0.12.0', false], ['v0.12.2', true], ['v0.13.0', true], ['v1.0.0', true]])('compares %s correctly', async (tag, isNew) => {
    expect(await checkUpdate('0.12.1', response(release(tag)))).toMatchObject({ latest: tag, current: 'v0.12.1', isNew });
  });
  it('propagates network failure and invalid JSON', async () => {
    await expect(checkUpdate('0.12.1', vi.fn(async () => { throw new Error('connection unavailable'); }))).rejects.toThrow('connection unavailable');
    await expect(checkUpdate('0.12.1', vi.fn(async () => ({ ok: true, json: async () => { throw new Error('Invalid JSON'); } })))).rejects.toThrow('Invalid JSON');
  });
});
