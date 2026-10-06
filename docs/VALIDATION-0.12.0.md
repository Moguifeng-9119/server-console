# Validation ledger — 0.12.0

Checked on 2026-10-06. Evidence below distinguishes simulated renderer checks, authenticated loopback SSH, a real Linux/NVIDIA host, and native packages.

## Local source and workflows

| Check | Result | Scope |
| --- | --- | --- |
| Typecheck | Passed | Strict renderer TypeScript and Electron checkJs |
| ESLint and Hooks | Passed, no errors or warnings | Source, backend, maintained scripts and tests |
| Regression suite | 106 passed in 11 files | Includes 12 recovery/staging tests and 10 locale-contract tests |
| SSH/SFTP smoke | Passed | Two authenticated loopback fixtures; final file/tree bytes compared |
| Production build | Passed | Nine locale bundles load on demand; xterm is separately bundled |
| Workbench browser checks | 22 passed | Simulated data, filters, theme, layout and stacked dialogs |
| File/editor/relay/language checks | 23 passed | Simulated IPC; dirty drafts, save lock, keyboard files, focus, resize and collapsed prefix progress; ten languages load, switch and reload |
| Local Windows native | 16 passed | Packaged source/assets SHA-256, sandboxed IPC, actual DPAPI, loopback SSH shell/forwarding and authenticated restart |
| Language switching | Passed in browser review | All ten languages; delayed competing loads preserve drafts and incoming events |
| Product demonstration | 27 seconds | Simulated GPU → process → terminal → files → relay → prefix progress; persistent simulation caption |

The final automated workflow additionally checks all ten languages on initial load, switch and reload. Raw receipts are under [evidence](evidence/). The language contract checks key coverage and interpolation; it does not establish native-speaker translation quality.

## Real Linux/NVIDIA acceptance

User-authorized existing SSH alias, existing OpenSSH known_hosts fingerprint, and a newly generated dedicated test directory. No passwords, key contents, endpoints or home paths are published. [Sanitized receipt](evidence/remote-acceptance-0.12.0.json).

- The application SSH collector detected six NVIDIA H100 PCIe GPUs. Two samples also returned a finite CPU percentage; comparison against independent Linux tooling remains pending.
- A random 16 MiB upload and subsequent download matched final SHA-256 digests.
- A child transfer process was forcibly terminated. A new manager recovered the task and actual 2 MiB remote stage, showed full-prefix verification progress, resumed and matched the original SHA-256.
- A committed cleanup intent survived manager restart and removed the actual owned remote stage. No staging files remained in the dedicated directory; generated test files and directory were cleaned up.

This kills the transfer subprocess, not the entire packaged Electron process. It is a real small-file recovery check, not a 100 GB throughput measurement. Large-prefix cancellation and reader-error paths are covered by controlled stream regressions. Full SHA-256 prefix verification still requires reading both prefixes.

The second authorized Docker alias closed all three connection attempts. Cross-server real rsync, source-to-destination connectivity failure and remote temporary-key cleanup under an interrupted direct transfer remain unverified. The local SFTP relay fallback has byte-level protocol regressions.

The user’s RTX 5070 Ti Laptop GPU was confirmed with local nvidia-smi. This read-only observation does not establish Windows local GPU collection by the app: the shipped collector targets Linux hosts over SSH. No GPU workload was started.

## Native packages and publication

All three platforms passed [source CI](https://github.com/Moguifeng-9119/server-console/actions/runs/37427109429) and [package/native CI](https://github.com/Moguifeng-9119/server-console/actions/runs/37427110686). Both tested application commit `6ff6603e6e3db2f972ff83ec40f3eb1835d80d8b`; later release/evidence documentation does not change application sources or renderer assets. Compact receipts: [source CI](evidence/source-ci-0.12.0.json) and [packages](evidence/packages-ci-0.12.0.json).

| Runner | Source checks | Native package evidence |
| --- | --- | --- |
| Windows x64 | Types, 106 tests, lint, SFTP smoke, build, 22 workbench and 23 workflow/language checks passed | Portable built, 16 native checks; actual DPAPI; [receipt](evidence/native-0.12.0-windows-ci.json) |
| Linux x64 | Same checks passed | AppImage built, 16 native checks under Xvfb; basic_text rejected for persistence, session-only; [receipt](evidence/native-0.12.0-linux.json) |
| macOS arm64 | Same checks passed | Universal DMG built, 16 native checks on arm64; MockKeychain; [receipt](evidence/native-0.12.0-macos.json) |

The local Windows unpacked build also passed [16 native checks](evidence/native-0.12.0-windows-local.json). Native tests compare the current package's Electron sources and built assets with the current source SHA-256, use generated fixture identities and isolated data, and exercise sandboxed IPC, computed shell output, sessions, resize, exact-byte forwarding, stopping an active tunnel and authenticated restart. The fixture shell is local and the native GPU metrics are simulated.

The downloaded Windows CI portable executable also passed an [actual wrapper startup check](evidence/portable-launch-0.12.0.json): isolated data, loopback CDP, working IPC bridge and visible v0.12.0. This is narrower than the 16 unpacked native checks.

[v0.12.0 is published](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.12.0) and marked latest. The [manual draft publisher](https://github.com/Moguifeng-9119/server-console/actions/runs/37429136498) passed workflow/source/tag guards and uploaded the verified binaries. Windows asset naming was normalized before final publication so checksum entries match public filenames. All three packages and SHA256SUMS.txt were then downloaded in full from public links without a GitHub authentication header; recomputed SHA-256, byte counts and manifest names matched the CI files and GitHub asset digests. [Download receipt](evidence/release-downloads-0.12.0.json). [0.11.1 evidence](VALIDATION-0.11.1.md) remains historical.

All packages remain unsigned. Playwright macOS automation uses MockKeychain; a passing result does not validate real Keychain. Universal packaging does not validate Intel macOS execution. Signing/notarization, installer/update, real Linux secret-service, remote PTY/MIG/NCCL and production fleet/network performance remain separate checks.

## Recovery boundaries

The staging journal is committed before a file can be written; cleanup intent is committed before unlink. Journal write failure prevents cleanup and preserves the old committed view. Only exact generated paths and their recorded connection identities can be cleaned. Active/paused recovery data is retained until the task is removed; no wildcard sweep or age-based deletion of another session’s files is performed. See the [recovery guide](USER-GUIDE.md).

Unknown stages created by older versions without ownership evidence are kept for manual inspection. A separate “forget old record only” action removes metadata, never those files. Corrupt journals are preserved and block further mutations.
