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

The local synthetic directory workload compares the previous production renderer with this build using the same simulated IPC and 12,000 file entries in each pane. Five monitoring/transfer update-to-frame samples were approximately 1.8–4.7 seconds before and 32–51 ms after. Eight one-click server switches all selected the intended server; this build painted in approximately 25–372 ms, including re-entering a file page. These are local browser measurements, not production SSH/network latency guarantees.

## Release status

Cross-platform CI, package/native results and the public installer download will be recorded here after completion. Windows packages are unsigned; the macOS package is not notarized. No test installation silently upgrades the existing user application or changes its data.
