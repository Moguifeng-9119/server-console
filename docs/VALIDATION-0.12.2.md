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
| Locale loading failures and keyboard races | 6 passed | System/persisted preferences, failed lazy imports, preserved settings, visible fallback and real Home/Enter cancellation of a delayed request |
| Browser translated layout | 60 checks | Ten locales at three viewport sizes, drawers and dialogs |
| Packaged native terminal | 16 checks | Current package/source/assets/catalog hashes; isolated loopback SSH, forwarding, restart, host trust, history and real Windows DPAPI |
| Packaged Windows layout | 36 checks | Six representative locales, native controls, maximized windows and 100/125/150% display scaling |

## Real server acceptance

The maintained opt-in script uses two existing trusted SSH aliases and fresh owner-marked test directories. It never logs credentials, hostnames, test paths or public/private keys in its public receipt. Existing OpenSSH fingerprints seed an isolated app trust store; TOFU is disabled.

On 2026-10-06, the current packaged Windows app passed all eight live checks on two real Linux hosts. A random 16 MiB payload was uploaded, the inspected Electron main process and its children were forcibly terminated during a partial staged upload, and restart restored a paused/resumable task. Resume exposed SHA-256 prefix progress, produced the expected final SHA-256 and removed the stage.

A direct relay was then interrupted by forcing the entire main process to terminate while remote rsync was running with a durably recorded public key. On restart, application reconnect cleanup removed the exact old authorized key and owned source scratch directory. Resuming completed with `direct=true` and `directMode=rsync`; the destination SHA-256 matched and the direct ownership journal was empty. Both owner-marked test directories were removed successfully. [Sanitized receipt](evidence/remote-desktop-0.12.2.json).

The live script verifies the inspected main executable and isolated userData before terminating its PID; on Windows the inspected main PID differed from Playwright's launcher PID. This was a whole-main-process test, distinct from the older transfer-subprocess test. It covers a bounded 16 MiB payload and two healthy trusted hosts, not every network failure or large-file scenario.

## Cross-platform release

Source and package workflow results, tested commits and public download digests are added after CI completes. Build scripts alone do not establish a published package.

## Remaining limits

- Windows binaries are unsigned; SmartScreen warnings remain possible. No signing certificate was supplied. macOS notarization is pending.
- macOS automation uses MockKeychain; real Keychain, Linux secret-service and Intel macOS execution remain unverified.
- Real 100 GB prefix timings, production fleet/network throughput, MIG/NCCL, native screen-reader acceptance and complete native-speaker wording review remain pending.
- Prefix resume still reads the entire local and remote prefix, with visible progress and cancellation.
- Source size/mtime does not lock concurrent rewrites. Unknown legacy stages retain their manual-inspection requirement.
- Direct-key coordination leaves one reusable empty account lock file. Cleanup covers exact resources recorded by this app, without scanning or deleting other sessions.
