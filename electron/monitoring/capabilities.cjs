// Capabilities probe: tests remote host for nvidia-smi, loop-ms, and python3 availability
const PROBE_CMD = [
  'command -v nvidia-smi >/dev/null 2>&1 && echo "SMI:1" || echo "SMI:0"',
  'command -v python3 >/dev/null 2>&1 && echo "PY3:1" || echo "PY3:0"',
].join('; ');

const cache = new Map();

async function probeCapabilities(connection, _serverId) {

  const defaultCaps = {
    hasNvidiaSmi: false,
    loopMsSupported: false,
    pythonAvailable: false,
    minSupportedIntervalMs: 500,
    legacyOnly: true,
  };

  try {
    const { stdout } = await connection.exec(PROBE_CMD, 5000);
    const hasSmi = /SMI:1/.test(stdout);
    const hasPy3 = /PY3:1/.test(stdout);

    const caps = {
      hasNvidiaSmi: hasSmi,
      loopMsSupported: hasSmi, // nvidia-smi supports loop queries
      pythonAvailable: hasPy3,
      minSupportedIntervalMs: hasSmi ? 200 : 500,
      legacyOnly: !/SMI:[01]/.test(stdout),
    };

    return caps;
  } catch (error) {
    // Authentication/transport errors must remain visible to the UI.
    if (/auth|timed out|timeout|ECONN|closed/i.test(String(error))) throw error;
    return defaultCaps;
  }
}

function clearCapabilitiesCache(serverId) {
  if (serverId) cache.delete(serverId);
  else cache.clear();
}

module.exports = {
  probeCapabilities,
  clearCapabilitiesCache,
  PROBE_CMD,
};
