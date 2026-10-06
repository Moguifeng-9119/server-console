import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DirectResources, DirectJournal } from '../electron/direct-resources.cjs';
import { TransferManager } from '../electron/transfer.cjs';

const directories = [];
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-direct-test-')); directories.push(dir);
  const commands = []; const identities = { source: hash('source'), destination: hash('destination') };
  const connections = Object.fromEntries(Object.keys(identities).map((id) => [id, { exec: async (command) => { commands.push([id, command]); return { code: 0 }; } }]));
  const manager = { storeFile: path.join(dir, 'tasks.json'), tasks: new Map(), emit() {},
    staging: { endpointIdentity: (id) => identities[id] }, _conn: async (id) => connections[id] };
  return { manager, commands, connections, identities, resources: new DirectResources(manager) };
}
const task = { id: 'task', serverId: 'source', peerId: 'destination' };
const tag = 'sckey-1234abcd';
describe('direct-transfer ownership', () => {
  it.each([0, 77])('removal respects direct cleanup exit status %i and never resurrects a removed task', async (code) => {
    const { manager, resources, connections, identities } = setup();
    manager.pub = (task) => ({ id: task.id, kind: task.kind, status: 'running' });
    await resources.register({ ...task, kind: 'relay', srcRemote: '/a', dstRemote: '/b' }, connections.source, connections.destination, tag);
    for (const connection of Object.values(connections)) connection.exec = async () => ({ code });
    const options = { storeFile: manager.storeFile, getConn: async (id) => connections[id], endpointIdentity: (id) => identities[id] };
    const restored = new TransferManager(options);
    expect(await restored.remove(task.id)).toBe(code === 0);
    await restored._persistNow(); clearTimeout(restored._saveTimer);
    expect(restored.directResources.journal.list()).toHaveLength(code === 0 ? 0 : 1);
    const again = new TransferManager(options);
    expect(again.tasks.has(task.id)).toBe(code !== 0);
    clearTimeout(again._saveTimer);
  });
  it('retains a journal-only recovered task across cleanup and another restart', async () => {
    const { manager, resources, connections, identities } = setup();
    manager.pub = (task) => ({ id: task.id, kind: task.kind, status: 'running' });
    const relay = { ...task, kind: 'relay', srcRemote: '/source/a', dstRemote: '/destination' };
    await resources.register(relay, connections.source, connections.destination, tag);
    const options = { storeFile: manager.storeFile, getConn: async (id) => connections[id], endpointIdentity: (id) => identities[id] };
    const restored = new TransferManager(options);
    await restored.directResources.collect();
    expect(restored.directResources.journal.list()).toEqual([]);
    const again = new TransferManager(options);
    expect(again.tasks.get(task.id)).toMatchObject({ status: 'paused', srcRemote: '/source/a' });
    clearTimeout(restored._saveTimer); clearTimeout(again._saveTimer);
  });
  it('keeps the recovery journal when the regular task store cannot commit', async () => {
    const { manager, resources, connections, identities } = setup();
    manager.pub = (task) => ({ id: task.id, kind: task.kind, status: 'running' });
    await resources.register({ ...task, kind: 'relay', srcRemote: '/a', dstRemote: '/b' }, connections.source, connections.destination, tag);
    const restored = new TransferManager({ storeFile: manager.storeFile, getConn: async (id) => connections[id], endpointIdentity: (id) => identities[id] });
    fs.mkdirSync(manager.storeFile + '.tmp');
    await restored.directResources.collect();
    expect(restored.directResources.journal.list()).toHaveLength(1);
    clearTimeout(restored._saveTimer);
  });
  it('restores a relay from the ownership journal before debounced task persistence', async () => {
    const { manager, resources, connections } = setup();
    manager.pub = (task) => ({ id: task.id, kind: task.kind, status: 'running' });
    const relay = { ...task, kind: 'relay', srcRemote: '/source/a', dstRemote: '/destination' };
    await resources.register(relay, connections.source, connections.destination, tag);
    expect(fs.existsSync(manager.storeFile)).toBe(false);
    new DirectResources(manager);
    expect(manager.tasks.get(task.id)).toMatchObject({ status: 'paused', srcRemote: '/source/a', dstRemote: '/destination' });
  });
  it('commits exact ownership before any remote mutation, then restores cleanup after restart', async () => {
    const { manager, resources, commands, connections } = setup();
    let entry = await resources.register(task, connections.source, connections.destination, tag);
    expect(commands).toEqual([]);
    expect(JSON.parse(fs.readFileSync(resources.journal.file, 'utf8')).entries).toHaveLength(1);
    entry = await resources.recordPublicKey(entry, 'ssh-ed25519 AAAA ' + tag);
    const restarted = new DirectResources(manager);
    await restarted.collect({ serverId: 'source' });
    expect(commands).toHaveLength(4);
    expect(commands[0][0]).toBe('destination');
    expect(commands[0][1]).toContain(tag + '$');
    expect(commands[0][1]).toContain('flock -x ~/.ssh/.serverconsole-keys.lock');
    expect(commands[1][1]).toContain(entry.owner);
    expect(commands[2][1]).toContain("[s]ckey-1234abcd");
    expect(new RegExp('[s]ckey-1234abcd').test(commands[2][1])).toBe(false);
    expect(restarted.journal.list()).toEqual([]);
  });
  it('does not sweep a currently active session', async () => {
    const { resources, commands, connections } = setup();
    await resources.register(task, connections.source, connections.destination, tag);
    await resources.collect({ serverId: 'source' });
    expect(commands).toEqual([]);
  });
  it('retains cleanup intent after nonzero remote exit and retries on reconnect', async () => {
    const { resources, connections } = setup();
    const entry = await resources.register(task, connections.source, connections.destination, tag);
    connections.source.exec = async () => ({ code: 77 });
    expect(await resources.cleanup(entry)).toBe(false);
    expect(resources.journal.list()[0].disposition).toBe('cleanup');
    connections.source.exec = async () => ({ code: 0 });
    await resources.collect({ serverId: 'source' });
    expect(resources.journal.list()).toEqual([]);
  });
  it('refuses cleanup against changed endpoints', async () => {
    const { resources, connections, identities, commands } = setup();
    const entry = await resources.register(task, connections.source, connections.destination, tag);
    identities.source = hash('different');
    expect(await resources.cleanup(entry)).toBe(false);
    expect(commands).toEqual([]);
    expect(resources.journal.list()).toHaveLength(1);
  });
  it('does not mutate remotely if ownership cannot be committed', async () => {
    const { resources, commands, connections } = setup();
    fs.mkdirSync(resources.journal.file + '.tmp');
    await expect(resources.register(task, connections.source, connections.destination, tag)).rejects.toThrow();
    expect(commands).toEqual([]);
    expect(resources.journal.list()).toEqual([]);
  });
  it('preserves corrupt and out-of-scope manifests and blocks mutations', async () => {
    const { resources, connections } = setup();
    const entry = await resources.register(task, connections.source, connections.destination, tag);
    const data = { version: 1, owner: entry.owner, entries: [{ ...entry, path: '/home/other' }] };
    const raw = JSON.stringify(data); fs.writeFileSync(resources.journal.file, raw);
    const journal = new DirectJournal(resources.journal.file);
    await expect(journal.markCleanup(task.id)).rejects.toThrow();
    expect(fs.readFileSync(resources.journal.file, 'utf8')).toBe(raw);
  });
});
