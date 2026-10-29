const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const hash = (file, algorithm, encoding = 'hex') => new Promise((resolve, reject) => { const digest = crypto.createHash(algorithm), stream = fs.createReadStream(file); stream.on('data', (chunk) => digest.update(chunk)); stream.on('error', reject); stream.on('end', () => resolve(digest.digest(encoding))); });
const scalar = (value) => { const text = value.trim(); return text.startsWith("'") && text.endsWith("'") ? text.slice(1, -1).replace(/''/g, "'") : text.startsWith('"') ? JSON.parse(text) : text; };

/** Parse the deliberately small electron-builder update-manifest schema. */
function updateManifest(source) {
  if (Buffer.byteLength(source) > 1048576) throw new Error('Update metadata exceeds 1 MiB');
  const result = { version: '', files: [], path: '', sha512: '' }; let current = null;
  for (const line of source.split(/\r?\n/)) {
    let match;
    if ((match = line.match(/^version:\s*(.+)$/))) result.version = scalar(match[1]);
    else if ((match = line.match(/^path:\s*(.+)$/))) result.path = scalar(match[1]);
    else if ((match = line.match(/^sha512:\s*(.+)$/))) result.sha512 = scalar(match[1]);
    else if ((match = line.match(/^\s*-\s*url:\s*(.+)$/))) { current = { url: scalar(match[1]), sha512: '', size: null }; result.files.push(current); }
    else if (current && (match = line.match(/^\s+sha512:\s*(.+)$/))) current.sha512 = scalar(match[1]);
    else if (current && (match = line.match(/^\s+size:\s*(\d+)$/))) current.size = Number(match[1]);
  }
  return result;
}

async function writeChecksums(directory, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  const names = fs.readdirSync(directory).filter((name) => /\.(exe|dmg|AppImage|zip|blockmap)$/.test(name) && name.includes(version) || /^latest(?:-[A-Za-z0-9_-]+)?\.yml$/.test(name)).sort();
  if (!names.some((name) => /\.(exe|dmg|AppImage)$/.test(name))) throw new Error('No release packages found');
  for (const name of names) if (!/^[A-Za-z0-9_.-]+$/.test(name) || !fs.lstatSync(path.join(directory, name)).isFile()) throw new Error('Release filenames must be regular ASCII files without spaces: ' + name);
  for (const name of names.filter((file) => file.endsWith('.yml'))) {
    const metadata = updateManifest(fs.readFileSync(path.join(directory, name), 'utf8'));
    if (metadata.version !== version || !metadata.files.length) throw new Error('Wrong or incomplete update metadata: ' + name);
    const entries = metadata.files.concat(metadata.path ? [{ url: metadata.path, sha512: metadata.sha512, size: null }] : []);
    for (const entry of entries) {
      if (!/^[A-Za-z0-9_.-]+$/.test(entry.url) || !names.includes(entry.url)) throw new Error('Update metadata references a missing or renamed package: ' + entry.url);
      const file = path.join(directory, entry.url);
      if (!entry.sha512 || await hash(file, 'sha512', 'base64') !== entry.sha512) throw new Error('Update SHA-512 does not match ' + entry.url);
      if (entry.size !== null && fs.statSync(file).size !== entry.size) throw new Error('Update size does not match ' + entry.url);
    }
  }
  const lines = []; for (const name of names) lines.push(await hash(path.join(directory, name), 'sha256') + '  ' + name);
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
  return names;
}
if (require.main === module) writeChecksums(path.resolve(process.argv[2] || 'release'), process.argv[3] || require('../package.json').version).then((names) => process.stdout.write('Verified metadata and checksummed ' + names.length + ' release files\n')).catch((error) => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { writeChecksums, updateManifest };
