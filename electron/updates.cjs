const RELEASE_API = 'https://api.github.com/repos/Moguifeng-9119/server-console/releases/latest';
const RELEASE_BASE = 'https://github.com/Moguifeng-9119/server-console/releases/tag/';

function versionParts(value) {
  if (typeof value !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(value)) throw new Error('Invalid release version');
  const parts = value.replace(/^v/, '').split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid release version');
  return parts;
}

async function checkUpdate(currentVersion, fetchRelease = fetch) {
  const current = 'v' + currentVersion;
  const currentParts = versionParts(current);
  const res = await fetchRelease(RELEASE_API, {
    headers: { 'user-agent': 'server-console', accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Update request failed (HTTP ${res.status})`);
  const release = /** @type {Record<string, unknown>} */ (await res.json());
  if (!release || typeof release !== 'object' || release.draft === true || release.prerelease === true) {
    throw new Error('Invalid published release');
  }
  const latest = release.tag_name;
  if (typeof latest !== 'string') throw new Error('Invalid release version');
  const latestParts = versionParts(latest);
  const url = RELEASE_BASE + encodeURIComponent(latest);
  if (release.html_url !== url) throw new Error('Invalid release URL');
  let isNew = false;
  for (let index = 0; index < 3; index++) {
    if (latestParts[index] === currentParts[index]) continue;
    isNew = latestParts[index] > currentParts[index];
    break;
  }
  return { latest, current, isNew, url };
}

module.exports = { checkUpdate, versionParts };
