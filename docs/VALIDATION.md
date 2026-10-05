# Validation ledger — 0.11.0 source change

Checked locally on Windows x64 with Node.js 22, Chrome and a locally packaged Electron 44.5.1 app. This ledger distinguishes source checks, Windows native checks and remote/platform validation. This local ledger was completed before publication. The v0.11.0 release uses the validated Windows portable package; see the [release](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.11.0). GitHub CI and other platform builds are subsequent checks, not results established by the local receipts.

| Layer | Command / evidence | Scope |
| --- | --- | --- |
| Renderer and backend types | `npm run typecheck` | Strict TypeScript renderer + Electron checkJs |
| Behavioral regression | `npm test` | 76 passing tests in 8 files: parsing, history, resource filtering, security migration, queue/recovery and real-SFTP integrity fixtures |
| Transport integration | `npm run smoke` | Two loopback fake SSH servers; byte comparisons for file/tree upload/download/relay, empty/Unicode files, queue and failure behavior |
| Production renderer | `npm run build` | Production assets compile, with CSP and lazy terminal/mock chunks |
| Browser interaction | `npm run test:ui` | 22 checks on production demo, both themes, English/Chinese and 900px/1440px viewports; no uncaught errors |
| Native Windows interaction | `SC_ELECTRON_PATH=<current packaged executable> npm run e2e:terminal` | 9 checks: package version/source SHA-256, real preload IPC, failed configuration-write preservation, real loopback SSH/local shell output, tab memory and two sessions; [raw receipt](evidence/native-terminal-local.json) |
| Windows portable launch | Local CDP launch of the final portable file | Launcher opens the production window at v0.11.0 and exposes the native bridge; [raw receipt](evidence/portable-launch-local.json). This is narrower than the nine unpacked-app checks. |
| Synthetic scalability baseline | `npm run benchmark` | 10/30 local sessions; [raw output](evidence/benchmark-local.json), [methodology](BENCHMARKS.md) |
| Code review | Read-only backend/React review plus repaired reproductions | Source review, not a third-party security certification |

## Concrete repaired failure cases

- A completed destination shorter than an unrelated source is replaced wholly, not used as an append prefix.
- A verified partial upload resumes correctly through a newly created transfer manager using disk recovery records.
- Changed upload source version, download source truncation and directory file growth after listing fail while preserving the completed target.
- Canceling a fully staged resume does not commit; tracked staging is cleaned.
- Local relay uses verified staging rather than arbitrary target bytes.
- Explicit MD5 mismatch is reported before replacing the target.
- Equivalent local destination paths and parent/child target conflicts are serialized; task-owned download stages prevent interleaving.
- Cleanup failure retains the task/manifest; legacy malformed credentials retain the original file rather than migrating an empty list.
- Corrupt host-trust/settings stores reject connections; failed atomic trust writes/removals roll back. Corrupt credential stores block subsequent saves; failed add/update/remove persistence leaves the in-memory list intact.
- Disabled TOFU persists; no secure backend stores no recoverable new password; steady metrics keep timestamped history and multi-GPU PID associations survive parsing.

## Browser checks

Fleet render; no demo anomaly toast; wide viewport; single-card 40 GiB predicate; empty/reset; GPU owner search; terminal/files tab shortcuts; compact matrix; process-menu focus across refresh; settings focus containment; credential mode; Escape/restore; palette visual layer above transfers; no duplicate commands; nested importer focus/Escape; alert details; visible history; English business labels; narrow viewport; no renderer exceptions. Current evidence lives in [ui-checks.json](evidence/ui-checks.json) and [screenshots](../assets/screenshots/).

## Not established here

- Real NVIDIA hardware, MIG/permissions and physical CPU/GPU comparison.
- Real remote rsync, temporary-key cleanup after process crash/disconnection, changing files during direct mode or production network throughput.
- Linux secret-service/keyring behavior or macOS Keychain behavior; unit fixtures are not OS encryption tests.
- macOS/Linux packages or native terminal checks, signing, Windows installer/update behavior, native forwarding/resize coverage and CI runs on GitHub.
- Full ten-language translation, screen-reader certification, full strict TypeScript backend conversion or ESLint/react-hooks lint.

The native script requires an explicit **unpacked app** executable path and rejects mismatched package versions/code/assets. The portable wrapper cannot be instrumented by Playwright's Electron launcher in this environment; its separate CDP startup check passed. Native checks run with isolated userData and an isolated instance lock, use only fake credentials, and verify computed shell output rather than echoed input. The fake shell is a pipe-based fixture, not a full PTY or remote Linux host. Windows results do not establish other platforms or real GPU accuracy. Re-run relevant native checks before publication.

Local unsigned Windows preview files live in ignored `release/0.11.0-local/`. The matching portable binary is provided in v0.11.0; the local receipts retain their original pre-publication timestamps/status. [checks-local.json](evidence/checks-local.json) records the final local check scope; binary sizes/hashes are recorded in [windows-package-local.json](evidence/windows-package-local.json).
