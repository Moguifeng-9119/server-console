import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { TextEditor, digest, MAX_TEXT } from '../electron/text-editor.cjs';
function fixture() {
  const files = new Map([['/work.py', Buffer.from('original')]]); const modes = [];
  const sftp = {
    lstat: (_file, cb) => cb(null, { mode: 0o100640, size: files.get('/work.py').length }),
    createReadStream: (file) => Readable.from([files.get(file)]),
    writeFile: (file, bytes, cb) => { files.set(file, bytes); cb(); },
    chmod: (file, mode, cb) => { modes.push(mode); cb(); },
    rename: (from, to, cb) => { files.set(to, files.get(from)); files.delete(from); cb(); },
    unlink: (file, cb) => { files.delete(file); cb(); },
  };
  const editor = new TextEditor({ getConnection: async () => ({ sftp: async () => sftp }) });
  return { files, sftp, editor, modes, request: { id: 'a', path: '/work.py', text: 'updated', expectedHash: digest(Buffer.from('original')) } };
}
describe('reviewed remote text replacement', () => {
  it('preserves file mode and returns a new fingerprint', async () => {
    const f = fixture(); const result = await f.editor.write(f.request);
    expect(f.files.get('/work.py').toString()).toBe('updated'); expect(f.modes).toEqual([0o640]); expect(f.files.size).toBe(1); expect(result.contentHash).toBe(digest(Buffer.from('updated')));
  });
  it('uses POSIX rename when standard SFTP rename cannot replace an existing file', async () => {
    const f = fixture(); const rename = f.sftp.rename; f.sftp.ext_openssh_rename = rename; f.sftp.rename = (_a, _b, cb) => cb(new Error('Failure: destination exists'));
    await f.editor.write(f.request); expect(f.files.get('/work.py').toString()).toBe('updated');
  });
  it('rejects a stale editor without touching remote content', async () => {
    const f = fixture(); f.files.set('/work.py', Buffer.from('another user edit'));
    await expect(f.editor.write(f.request)).rejects.toThrow('Remote file changed'); expect(f.files.get('/work.py').toString()).toBe('another user edit'); expect(f.files.size).toBe(1);
  });
  it('removes the stage if the destination changes during upload', async () => {
    const f = fixture(); const write = f.sftp.writeFile;
    f.sftp.writeFile = (file, bytes, cb) => { write(file, bytes, () => { f.files.set('/work.py', Buffer.from('late edit')); cb(); }); };
    await expect(f.editor.write(f.request)).rejects.toThrow('changed during save'); expect(f.files.get('/work.py').toString()).toBe('late edit'); expect(f.files.size).toBe(1);
  });
  it('refuses missing fingerprints and oversized edits', async () => {
    const f = fixture(); await expect(f.editor.write({ ...f.request, expectedHash: undefined })).rejects.toThrow('fingerprint');
    await expect(f.editor.write({ ...f.request, text: 'a'.repeat(MAX_TEXT + 1) })).rejects.toThrow('limit');
  });
});
