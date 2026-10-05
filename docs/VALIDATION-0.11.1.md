# Validation ledger — 0.11.1

This patch follows the published [v0.11.0](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.11.0). The previous source CI passed on Windows, Linux and macOS. Its manual packaging run revealed accidental electron-builder publication on Linux/macOS after successful package creation; all packaging scripts now explicitly use `--publish never`.

## Local checks

Windows x64, Node.js 22, production Electron 44.5.1 unpacked application:

| Check | Result | Scope |
| --- | --- | --- |
| Types | Passed | Strict renderer TypeScript and backend checkJs |
| Behavioral tests | 84 passed in 9 files | Includes 8 forwarding lifecycle tests using local TCP sockets |
| Transport smoke | Passed | Two authenticated loopback SSH fixtures, real SFTP protocol and byte comparisons |
| Renderer build | Passed | Production application assets |
| Browser interactions | 22 passed | Demo data, themes, languages, filters, modal focus and responsive layout |
| Native package | 16 passed | [Windows raw receipt](evidence/native-terminal-0.11.1-windows.json) |

Native checks verify packaged source/assets SHA-256, preload IPC, failed configuration writes, computed keyboard-entered shell output, tab/session persistence, SSH resize, exact-byte SSH forwarding, active-tunnel stop/removal, Windows DPAPI encryption, authenticated restart, persisted timestamped history and host trust. Only generated keys and fixture passwords are used, with an isolated userData directory. History IPC checks pause renderer timers installed before page reload; this tests persistence without racing the renderer's normal periodic save.

The terminal fixture is a local pipe shell, not a full remote PTY. Metrics are simulated. Windows DPAPI is tested through Electron safeStorage and authenticated restart. Playwright launches macOS with MockKeychain, so a macOS safeStorage result cannot establish real Keychain behavior. Linux without secure storage must remain session-only.

## Repaired forwarding failures

- Stopping or replacing a forward with an open TCP client waited indefinitely for client disconnection.
- Disabling/removing a rule during pending SSH setup allowed the old operation to reopen its listener.
- A late rejected handshake could overwrite the latest operation's status.
- An SSH channel closing without an error left its local TCP client open.
- A late SSH channel callback after stop needed to destroy the obsolete channel immediately.

Regression tests cover these cases. Per-rule intent tokens cancel outdated work; only local listener bind/close operations are serialized, so stopping does not wait for an SSH handshake.

## Publication and cross-platform checks

v0.11.0 public unauthenticated download returned HTTP 200 and exactly matched the uploaded Windows portable SHA-256; see [download receipt](evidence/release-download-0.11.0.json). Its three-platform source CI passed: [run 37314732405](https://github.com/Moguifeng-9119/server-console/actions/runs/37314732405).

The 0.11.1 Windows portable build and GitHub three-platform package/native checks are being completed. Their final results will be added with the release; this source ledger does not claim pending checks have passed.

## Remaining boundaries

Real NVIDIA/MIG hardware, production remote rsync and network throughput, real macOS Keychain/Linux secret-service, signing/notarization, Windows installer/update and physical remote PTY behavior remain unverified. See the [0.11.0 ledger](VALIDATION.md) for the broader UI/security/transfer evidence and [benchmark methodology](BENCHMARKS.md) for the synthetic 10/30-session baseline.
