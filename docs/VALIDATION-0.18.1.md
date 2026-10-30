# ServerConsole v0.18.1 validation ledger

Date: 2026-10-30 (Asia/Shanghai)

| Check | Result / scope |
| --- | --- |
| Unit/integration tests | **48 files / 362 tests passed** on Windows |
| ESLint, TypeScript, production build | Passed |
| SSH/SFTP smoke | Passed, two authenticated loopback SSH fixtures |
| Production renderer | **22 smoke checks**, **19 workbench checks**, file/editor workflows and ten locale reload scenarios passed |
| Language initialization | Six initialization/failure/race scenarios passed |
| Native packaged terminal | **23 checks passed**, including actual runtime tray image, encrypted credentials, session scrollback, forwarding and SQLite |
| Native Windows chrome/layout | **36 scenarios passed**, including normal/maximized windows at 100%, 125% and 150% scaling |
| Packaged workbench IPC | **14 checks passed**, including source hashes, reports, SFTP conflicts, import rollback and forwards |
| Forced Electron-main exit during import | Killed the packaged main process after each of servers.json, workbench.json and productivity.json writes. All three restart scenarios restored original configuration and exposed a failed import receipt without applying staged browser preferences |
| Real SSH monitoring | Existing trusted aliases 1docker and 2docker passed GPU stream, system/process sampling, resource counters and nonzero exit status |
| Dedicated remote task | Both hosts captured exit code 7 and output, then removed the exact owned task directory |
| Windows NSIS | Current 0.18.1 installer and blockmap built; installer execution/upgrade runs only in isolated CI |
| Platform CI/package jobs | Pending publication-time workflow results; linked below when complete |
| Signing | Windows unsigned; macOS unsigned/unnotarized, manual updating only |

## Real-host observations

| Alias | GPU | System | Processes | Stream | Owned task removed |
| --- | ---: | ---: | ---: | --- | --- |
| 1docker | 105 | 7 | 3 | yes | yes |
| 2docker | 79 | 7 | 3 | yes | yes |

Receipts are local ignored files under test-artifacts. Host endpoints, credentials,
key material and log contents are not published. Observation counts are bounded
acceptance evidence, not FPS or fleet-throughput measurements.

## Recovery and failure regressions

- Queue-full changes remain pending and retry after capacity returns. Repeated
  changes coalesce by pathname. Failures after successful enqueue do not enqueue
  the same batch again.
- Query failures clear untrusted GPU occupancy while preserving ordinary process
  rows. Usage tracking stops until a valid observation is available.
- Per-module failures preserve connection state and unrelated history channels.
  Buffered frames and late SSH callbacks are rejected across reconnects.
- Pathological regex rules are individually disabled after their execution budget;
  other rules and loss extraction continue. A raw preview and visible error remain.
- A/B/C split tests cover focus, replacement and closing either side without moving the other. A controlled delayed-focus regression verifies that form input cannot be sent to a remote terminal.
- Imports retain committed state on navigation, persist queryable results and use
  a local undo journal for interrupted multi-file writes. Journal backups preserve
  already-encrypted server-store bytes rather than decrypted credentials.

## Reproduce

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run smoke
npm run build
npm run test:ui
npm run test:workflow
npm run test:language-ui
node scripts/workbench-v18-ui.cjs
npm run dist:win:nsis
node scripts/native-ci.cjs
node scripts/release-checksums.cjs release
```

The installer-upgrade script is CI-only and tests 0.18.0 to 0.18.1. Native checks
use isolated SC_USER_DATA and leave the user's installed application untouched.
macOS/Linux coverage requires their successful jobs and actual release assets.

## Remaining boundaries

Directories exceeding the bounded pending/scan limits require narrowing or
exclusions and an explicit complete upload. Unreadable scan directories retain
an error rather than being marked fully synchronized. Timed-out rule matches
need manual review of raw logs. Real Slurm/MIG/ECC/NVLink, notification delivery
endpoints, 100 GB transfers and the planned 10-host / eight-GPU / 200 ms stress
scenario require separate acceptance. Persistent training runs, experiment
comparison, desktop headless source integration and task submission follow in
later roadmap stages.

Navigation CI asserts zero repeated large-directory sorts during background updates.
Raw double-frame wall-clock timings include OS scheduling and are retained in the
receipt; set SC_ENFORCE_NAV_TIMING=1 on a controlled machine to enforce the 700 ms
legacy smoke budget. The separate 150 ms fleet P95 target remains unverified.
