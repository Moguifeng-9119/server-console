# ServerConsole v0.19.0 validation ledger

Date: 2026-10-31 (Asia/Shanghai)

| Check | Result / scope |
| --- | --- |
| Unit/integration tests | 51 files / 393 tests passed on Windows |
| ESLint, TypeScript, production build | Passed |
| Research renderer | 17 checks passed: lazy loading, curves, correct metric CSV, stable chart instances, launch validation, independent runs, evidence, deletion, workspace defaults, delayed user edits and ten languages at 900px |
| Existing renderer regressions | 22 UI smoke, 19 workbench, eight monitoring, seven navigation and six language initialization/failure checks passed |
| SSH/SFTP smoke | Two authenticated loopback fixtures passed collection, file/directory transfer, relay and failure paths |
| Native Windows package | NSIS installer and blockmap built; 23 terminal, 36 window/language/scale and 15 packaged IPC checks passed against the final source-matching executable |
| Real SSH task-to-run chain | Trusted aliases 1docker and 2docker passed; each owned task exited 7, persisted loss values 0.5 / 0.3 / null and synthetic NaN/OOM evidence, then removed its exact remote task directory |
| Cross-platform source/package workflows | Pending this release commit; update this ledger with successful workflow IDs before publishing |
| Signing | Windows unsigned; macOS unsigned/unnotarized with manual updating |

## Failure and recovery coverage

- A 4,500-line log commits its first 8,000 metric points, fails its second
  batch, retains the old cursor, and retries to the exact expected point count.
- A failed cursor commit does not duplicate already stored metrics or evidence.
- Task exit facts survive a failed event commit and a failed Run update; later
  observations reconcile and emit one completion event.
- Automatic log binding retries transient failures. Database tombstones prevent
  stale tasks from recreating a deleted Run after restart.
- Invalid pre-migration backups stop schema migration while preserving the
  original tables. Good backups pass integrity, schema and row-count checks.
- Downsampling retains missing counts and extrema. Step seeking uses a covering
  index without a temporary sort.
- Remote log timestamps remain on curves; client observation time controls
  stall detection. An hour of clock skew does not create an immediate stall.
- Disk diagnostics use a confirmed physical directory. Missing resolution and
  normalized '..' paths cannot select a guessed full filesystem.
- Delayed workspace defaults preserve both an edited directory and a GPU
  selection that the user intentionally cleared.

Browser journeys use labelled simulated training data. The real SSH acceptance
uses synthetic log records and a short owned shell task, not a model training
benchmark. Counts and receipts do not establish native GPU FPS or a fleet-wide
latency guarantee. Local ignored receipts are under test-artifacts; endpoints,
credentials and private keys are not published.

## Reproduce

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run smoke
npm run build
npm run test:research
node scripts/workbench-v18-ui.cjs
npm run test:monitor
npm run test:navigation
npm run test:language-ui
npm run dist:win:nsis
node scripts/native-ci.cjs
```

`native-ci` uses the unpacked application and isolated user data. Installer
upgrade checks run only on an isolated Windows CI runner because NSIS changes
registered installation state.
