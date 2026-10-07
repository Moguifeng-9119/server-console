# Validation — 0.12.3

This release addresses navigation responsiveness, terminal continuity and Windows installation. Previous real GPU and crash-transfer evidence remains in the [0.12.2 ledger](VALIDATION-0.12.2.md); it is not a fresh 0.12.3 remote-production test.

## Local verification

| Check | Result | Scope |
| --- | --- | --- |
| Unit regressions | 164 passed, 17 files | Existing SSH, language, recovery, bandwidth and update behavior |
| Typecheck, lint and production build | Passed | Renderer TypeScript, backend checkJs and Hooks |
| Authenticated loopback SSH/SFTP smoke | Passed | Two fixture SSH servers, real transport, file trees and hashes |
| Production navigation | 7 checks passed | Simulated IPC, 12,000 files in each pane, slow remote requests, replay/live races and stale lists |
| Native Windows terminal/IPC | 21 checks passed | Current packaged code hashes, real preload and authenticated loopback shell |
| Workbench UI | 22 checks passed | Production browser demo, explicit GPU actions and dialog focus |
| Workflow/locales | 23 checks passed | File/editor/relay controls, unsaved drafts and ten languages |
| Browser layout | 60 cases passed | Ten languages, window sizes and sidebar widths |
| Native Windows layout | 36 cases passed | Six languages, 100/125/150% scale, normal/maximized window |
| Language failures/races | 6 cases passed | Preference persistence and delayed resource failure/cancellation |

Native additions verify actual terminal-chip switches with unchanged xterm nodes, 45 background lines exactly once, server/overview navigation with unchanged session IDs and shell variables, closing the active terminal, renderer reload replay without duplicates, and server-removal cleanup. Full application restart verifies configuration/credential policy; it does not claim live SSH-shell recovery.

The local synthetic directory workload compares the previous production renderer with this build using the same simulated IPC and 12,000 file entries in each pane. Five monitoring/transfer update-to-frame samples were approximately 1.8–4.7 seconds [before](evidence/navigation-baseline-0.12.2.json); the latest local run measured 21–33 ms [after](evidence/navigation-0.12.3-local.json). Eight one-click server switches all selected the intended server and painted in approximately 21–275 ms, including re-entering a file page. These are local browser measurements, not production SSH/network latency guarantees.

## Release status

All three platforms passed [source CI](https://github.com/Moguifeng-9119/server-console/actions/runs/37590957458) and [package/native CI](https://github.com/Moguifeng-9119/server-console/actions/runs/37590959257) at application commit `c72e1b54956161559e1607d3df2e5d1cc1ed39c9`. [Source receipt](evidence/source-ci-0.12.3.json) and [package receipt](evidence/packages-ci-0.12.3.json) record the completed jobs.

| Platform | Source validation | Current packaged native validation |
| --- | --- | --- |
| Windows x64 | 164 tests; lint/types/build; SSH/SFTP smoke; 22 UI, 23 workflow, 60 layout, 6 language and 7 navigation checks | 21 terminal/IPC and 36 layout; real DPAPI; NSIS installer |
| Linux x64 | Same source checks passed | 21 terminal/IPC and 12 layout under Xvfb; credentials remain session-only without secure storage |
| macOS arm64 | Same source checks passed | 21 terminal/IPC and 12 layout; universal DMG; Playwright MockKeychain, not real Keychain |

The final terminal harness waits for completed asynchronous IPC predicates on the Node side and checks the second server's real shell readiness, then compares the full retained ID set. Earlier POSIX fixture pipes lacked terminal ONLCR output translation; the final fixture includes per-stream UTF-8 decoding and POSIX newline translation. These corrected runs are the release evidence.

The local NSIS embedded payload was extracted to an owned temporary directory and its app archive matched the current unpacked package. Three launches verified v0.12.3, the navigation UI and native preload/settings IPC; timings were approximately 2.3, 1.0 and 1.4 seconds. This checks the executable layout produced by installation; it does not claim an actual registry installation or an upgrade of the user's existing application. [Local payload receipt](evidence/installer-0.12.3-local.json).

Windows packages are unsigned; the macOS package is not notarized.

## Published download verification

[v0.12.3](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.12.3) is public and marked as the latest release. The [publisher workflow](https://github.com/Moguifeng-9119/server-console/actions/runs/37594465940) completed successfully after checking the matching source and package validation runs.

The public checksum manifest and the complete Windows NSIS installer were downloaded without authentication. All 24 HTTP ranges returned the exact requested offsets and sizes; the assembled 118,569,957-byte installer matched SHA-256 `079e47f0b161269bfb2ffbd15fd84175df834201f4d270c5857b721066b912e9`. The other published binaries' GitHub asset digests matched the manifest; they were not downloaded locally again. [Public download receipt](evidence/release-downloads-0.12.3.json).

The verified public installer payload was extracted into an owned temporary directory. One launch with isolated application data verified version 0.12.3, the navigation UI and native preload/settings IPC. Startup to navigation took approximately 3.5 seconds in this local acceptance run. No installer wizard, registry installation or upgrade of the user's existing application was performed. [Public payload launch receipt](evidence/installer-launch-0.12.3-public.json).
