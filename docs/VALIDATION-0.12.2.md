# Validation — 0.12.2

This ledger separates local regression automation, real authorized servers and cross-platform packaging. Older version ledgers remain historical.

## Local source and Windows package

| Check | Result | Scope |
| --- | --- | --- |
| Regression suite | 164 passed in 17 files | Remote exit codes/signals, update validation, language catalogs/settings, bandwidth/backpressure, staging and direct ownership recovery |
| Typecheck, ESLint/Hooks and production build | Passed | Strict renderer TypeScript and backend checkJs |
| Two loopback SSH/SFTP smoke | Passed | Upload/download/tree/local relay exact bytes and queue/failure behavior; simulated server metrics |
| Browser workbench | 22 checks | Production renderer with simulated IPC |
| Browser workflow | 23 checks | Files, editor, relay and all locale switches; simulated IPC |
| Locale loading failures and keyboard races | 6 passed | System/persisted preferences, failed lazy imports, preserved settings, visible fallback and native keyboard typeahead/Enter cancellation of a delayed request; [receipt](evidence/languages-0.12.2.json) |
| Browser translated layout | 60 checks | Ten locales at three viewport sizes, drawers and dialogs |
| Packaged native terminal | 16 passed | Current package/source/assets/catalog hashes; isolated loopback SSH, forwarding, restart, host trust, history and real Windows DPAPI; [receipt](evidence/native-0.12.2-windows-local.json) |
| Packaged Windows layout | 36 passed | Six representative locales, native controls, maximized windows and 100/125/150% display scaling; [receipt](evidence/layout-0.12.2-windows-local.json) |

## Real server acceptance

The maintained opt-in script uses two existing trusted SSH aliases and fresh owner-marked test directories. It never logs credentials, hostnames, test paths or public/private keys in its public receipt. Existing OpenSSH fingerprints seed an isolated app trust store; TOFU is disabled.

On 2026-10-06, the current packaged Windows app passed all eight live checks on two real Linux hosts. A random 16 MiB payload was uploaded, the inspected Electron main process and its children were forcibly terminated during a partial staged upload, and restart restored a paused/resumable task. Resume exposed SHA-256 prefix progress, produced the expected final SHA-256 and removed the stage.

A direct relay was then interrupted by forcing the entire main process to terminate while remote rsync was running with a durably recorded public key. On restart, application reconnect cleanup removed the exact old authorized key and owned source scratch directory. Resuming completed with `direct=true` and `directMode=rsync`; the destination SHA-256 matched and the direct ownership journal was empty. Both owner-marked test directories were removed successfully. [Sanitized receipt](evidence/remote-desktop-0.12.2.json).

The live script verifies the inspected main executable and isolated userData before terminating its PID; on Windows the inspected main PID differed from Playwright's launcher PID. This was a whole-main-process test, distinct from the older transfer-subprocess test. It covers a bounded 16 MiB payload and two healthy trusted hosts, not every network failure or large-file scenario.

Read-only production GPU collection also succeeded on both hosts: six and eight H100 PCIe cards, valid memory/utilization and CPU counters. Neither sample contained a naturally occurring multi-GPU PID; synthetic tests cover that mapping, but these samples do not validate it on real workloads. Local Windows NVIDIA output for an RTX 5070 Ti Laptop GPU passed the GPU CSV parser, including preserving unavailable fan readings as null. This local check does not validate Linux system collection on Windows. [Sanitized GPU receipt](evidence/gpu-0.12.2.json). No workloads were started.

## Cross-platform release

All three platforms passed [source CI](https://github.com/Moguifeng-9119/server-console/actions/runs/37464925855) and [package/native CI](https://github.com/Moguifeng-9119/server-console/actions/runs/37464929231), both at application commit `de46e81cd7e908bbcb5cf27da5b5716a3fdbee7a`. [Source receipt](evidence/source-ci-0.12.2.json) and [package receipt](evidence/packages-ci-0.12.2.json) record each job and completed checks.

| Platform | Source | Packaged native checks | Credential scope |
| --- | --- | --- | --- |
| Windows x64 | 164 tests, lint/types, SFTP smoke, 22 workbench, 23 workflow, 60 layout and 6 language checks | 16 terminal/IPC + 36 layout; [receipt](evidence/native-0.12.2-windows-ci.json) | Real Windows DPAPI |
| Linux x64 | Same source checks passed | 16 terminal/IPC + 12 native layout under Xvfb; [receipt](evidence/native-0.12.2-linux-ci.json) | Session-only when secure storage is unavailable; real secret-service unverified |
| macOS arm64 | Same source checks passed, including native keyboard typeahead cancellation | Universal DMG built; 16 terminal/IPC + 12 native layout on arm64; [receipt](evidence/native-0.12.2-macos-ci.json) | Playwright MockKeychain, not real Keychain |

These native packages compare backend sources, production assets and all ten catalogs with the runner's current source hashes. Release commit `f61b1bf427892d1106c94bd55ee89c838995f5a2` adds documentation and receipts without changing the tested application.

[v0.12.2 is published](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.12.2) as the latest stable release. The [draft publisher](https://github.com/Moguifeng-9119/server-console/actions/runs/37466237731) passed source/package/head guards and uploaded Windows x64 portable, Linux x64 AppImage, macOS universal DMG and SHA256SUMS.txt. All three binary GitHub digests match the checksum manifest. The public manifest and full 106,187,156-byte Windows binary were downloaded without authentication and their SHA-256 values matched; the Windows file used 24 validated HTTP ranges after a slow single-connection download timed out. macOS/Linux public payloads were not downloaded locally in this check. [Download receipt](evidence/release-downloads-0.12.2.json).

The downloaded Windows portable wrapper also passed actual startup: visible v0.12.2, renderer navigation, native preload and settings IPC with isolated fresh data. This uses loopback CDP because the portable wrapper does not relay inspector stderr to Playwright's Electron launcher. It is a startup check, separate from the 16 unpacked native checks and the real two-server forced-main-crash test. [Portable receipt](evidence/portable-launch-0.12.2.json).

## Remaining limits

- Windows binaries are unsigned; SmartScreen warnings remain possible. No signing certificate was supplied. macOS notarization is pending.
- macOS automation uses MockKeychain; real Keychain, Linux secret-service and Intel macOS execution remain unverified.
- Real 100 GB prefix timings, production fleet/network throughput, MIG/NCCL, native screen-reader acceptance and complete native-speaker wording review remain pending.
- Prefix resume still reads the entire local and remote prefix, with visible progress and cancellation.
- Source size/mtime does not lock concurrent rewrites. Unknown legacy stages retain their manual-inspection requirement.
- Direct-key coordination leaves one reusable empty account lock file. Cleanup covers exact resources recorded by this app, without scanning or deleting other sessions.
