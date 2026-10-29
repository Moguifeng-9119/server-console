# ServerConsole v0.18.0 validation ledger

Date: 2026-10-29 (Asia/Shanghai)

This is the current release-candidate ledger. Pending rows must be replaced with
actual results before describing a platform package as verified.

| Check | Result / scope |
| --- | --- |
| Unit/integration suite | **330 tests passed** on Windows |
| ESLint | Latest development run passed; final release checkout rerun pending |
| TypeScript | Latest development run passed; final release checkout rerun pending |
| New production-browser workflows | **14 mocked UI checks passed**; fixture data, not a real remote fleet |
| New extension tests | **28 passed** across productivity, headless monitor, save-and-upload and existing DevSync tests |
| Headless storage/API | Authenticated read-only API queried observations from the **real SQLite worker** in an isolated local directory |
| Real SSH monitoring | **1docker and 2docker passed** trusted host-key checks, nonzero exit codes, GPU streams, system/process lanes and resource observations |
| Owned remote tasks | Both hosts captured output and **exit code 7**, including a command using `exec`; exact owned test files were removed |
| Remote guarded stop/log | Dedicated 1docker task-stop identity check and incremental log inspection passed; no user workload stopped |
| Windows package | Local 0.18.0 NSIS built; 11 packaged IPC checks, native terminal replay and Windows DPI/layout checks passed; packaged IPC checks re-run after final changes |
| Windows install/upgrade | CI-only isolated installer scenario added; execution pending |
| macOS/Linux packages | Three-platform package workflow pending; do not infer installer coverage from source tests |
| Signing/notarization | Windows unsigned; macOS unnotarized; no signing credential configured |

## Real-host acceptance

Local receipt: `test-artifacts/workbench-remote/checks.json` (ignored test output).
The receipt records version 0.18.0 and both hosts passing without collection errors.

| Alias | GPU observations | System observations | Process observations | Stream seen | Owned task cleaned |
| --- | ---: | ---: | ---: | --- | --- |
| 1docker | 105 | 7 | 3 | yes | yes |
| 2docker | 79 | 7 | 3 | yes | yes |

These are bounded acceptance observations, not a refresh-rate/FPS benchmark.
Connection material, addresses, key contents and credentials are not published in
the ledger. The fixture only creates and removes exact task-owned files.

## Reproduce local checks

```sh
npm run lint
npm run typecheck
npm test
npm run smoke
npm run build
npm run test:ui
npm run test:workflow
npm run test:layout
npm run test:language-ui
npm run test:navigation
npm run test:monitor
```

Extension regressions:

```sh
npx vitest run tests/productivity.test.cjs tests/devsync.test.cjs tests/devsync-completion.test.cjs tests/headless-monitor.test.cjs
```

Package-native checks use the candidate executable and isolated `SC_USER_DATA`.
The Windows installer-upgrade script deliberately refuses to run outside GitHub
Actions to avoid altering a developer's registered installation.

## Limits requiring separate acceptance

Real Slurm installations, NVIDIA MIG/ECC/NVLink diagnostics, notification endpoints,
long-running training log rotation, simultaneous large-directory synchronization,
100GB transfers and sustained multi-host switching performance require their own
environment-specific checks. Mocked UI tests establish interaction behavior, and
the two-host checks establish those particular SSH workflows; neither replaces
these broader acceptance cases. Optional headless collection has a separate data
directory and lifecycle and does not start automatically with the desktop.
