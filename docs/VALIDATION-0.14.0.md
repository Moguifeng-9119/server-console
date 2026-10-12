# ServerConsole v0.14.0 Validation Ledger

Date: 2026-10-12
Version: 0.14.0

### Test Execution Summary

| Suite / Check | Command | Result | Details |
|---|---|---|---|
| **Unit & Integration Tests** | `npm test` (`vitest run`) | **27/27 files passed, 201/201 tests passed** | Includes all new monitoring tests |
| **Static Type Analysis** | `npm run typecheck` | **0 errors** | `tsc -b && tsc -p tsconfig.electron.json` |
| **Code Linting** | `npm run lint` | **0 warnings, 0 errors** | `eslint src electron scripts tests eslint.config.mjs` |
| **E2E Smoke Testing** | `npm run smoke` | **Passed (exited 0)** | Dual fake-sshd: collection, upload, download, relay, recovery |

### Monitoring Specific Tests

1. `tests/monitoring-store.test.ts`:
   - Host A telemetry updates do not trigger Host B subscribers.
   - Stable object references across unchanged reads.
2. `tests/monitoring-motion.test.ts`:
   - Single RAF loop smoothly steps gauge stroke-dasharray values.
   - Pauses on hidden tabs; snaps instantly under `prefers-reduced-motion`.
3. `tests/monitoring-tiered.test.cjs`:
   - Independent collection lanes: slow `ps` query does not block rapid GPU ticks.
   - Strict non-reentrancy per host & per lane.
4. `tests/monitoring-aggregator.test.cjs`:
   - 1-second statistical buckets preserve min/max peaks (e.g. 12% to 95% spike).
   - Trapezoidal integration and coverage tracking.
5. `tests/monitoring-stream-channel.test.cjs`:
   - Handles partial chunk boundaries and multiline UTF-8 buffers.
   - Safe cleanup and shutdown.
6. `tests/monitoring-protocol.test.cjs`:
   - Frame creation, delta calculation, and patch application.
   - Distinguishes 0 from null.
7. `tests/monitoring-publish-buffer.test.cjs`:
   - Coalesces rapid state frames within configured window.
   - Immediate bypass for critical status updates.
8. `tests/monitoring-rate-controller.test.cjs`:
   - AIMD rate decrease on congestion / high latency.
   - Additive increase (+0.5 Hz) after 10s stability.
9. `tests/history-db.test.cjs`:
   - Batch insertion of 1-second buckets (`appendBuckets`).
   - `raw_buckets` schema verification, minute rollup, and cleanup.
