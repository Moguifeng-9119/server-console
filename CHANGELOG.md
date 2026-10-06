# Changelog

## 0.12.1

- Reserve a separate Windows title-bar band for native window controls, including settings, transfers and dialog overlays.
- Adapt toolbars, segmented controls, settings rows and dialog actions to long translations and narrow windows.
- Add geometry regressions for all ten languages and packaged native window checks, including Windows display scaling and maximized windows.

## 0.12.0 — 2026-10-06

- Commit staging ownership before writes and cleanup intent before deletion; restore crash-orphaned tasks and retry exact owned cleanup on server reconnect. Preserve unknown legacy stages, corrupt journals and failed writes.
- Show complete SHA-256 prefix-check progress separately from transferred bytes, with cancellation and reader-failure handling.
- Explain old recovery limitations as paused records and provide metadata-only removal for unowned legacy stages. Preserve overview polling behavior.
- Localize previously hardcoded file/import/relay/parallel/editor flows; complete ten locale key contracts and load non-English resources on demand. Machine-assisted wording still needs full native-speaker review.
- Add keyboard file selection/open/actions/resizing, terminal buttons, relay focus and unsaved/saving text navigation protection. Wrap sidebar footer actions for longer translations.
- Add 12 staging/recovery regressions, 10 locale contracts, production workflow/language checks, ESLint/Hooks CI, English/Chinese detailed guides, simulated demonstration and transfer screenshots.
- Verify real 16 MiB SSH/SFTP upload/download hashes, forced transfer-subprocess recovery, prefix progress and remote staging cleanup on one six-H100 Linux host. Second host unavailable; real cross-server rsync remains pending.

Current source and platform evidence: [0.12.0 validation ledger](docs/VALIDATION-0.12.0.md).

## 0.11.1 — 2026-10-05

- Stop and replace active port forwards promptly by closing their local sockets and SSH channels.
- Cancel obsolete forwarding starts during connection setup, SSH handshake and local bind. Serialize listener changes, preserve the latest disable/remove intent and propagate remote channel closure.
- Disable electron-builder auto-publication explicitly for every desktop packaging command; tag builds no longer require a publishing token.
- Run packaged native IPC/SSH checks in the manual Windows/Linux/macOS build workflow, with isolated test data and credentials.
- Expand native checks to terminal resize, SSH forwarding, active-tunnel stop, credential encryption policy and authenticated restart, history and host-trust persistence. Distinguish Windows DPAPI from Playwright's macOS MockKeychain.

Local Windows validation: 84 tests in 9 files, 22 browser checks and 16 packaged native checks passed, as did type checking, production build and SFTP smoke. Cross-platform native results and published assets are recorded separately in the [validation ledger](docs/VALIDATION-0.11.1.md).

## 0.11.0 — 2026-10-05

- Find GPUs by single-card free memory, model and owner; open monitor/terminal/files directly. Show freshness and default multi-card views to a compact matrix.
- Group settings, expose credential mode/backend, add active/resolved alert details and suppress demo notifications. Limit toasts to two with dismissal.
- Add visible process actions, modal visual/focus stacking, keyboard containment and focus restoration. Maintain redesigned labels in English/Simplified Chinese with documented fallback.
- Compute CPU busy percentage from `/proc/stat` deltas. Preserve all GPU indices for a PID and associate users with GPU processes.
- Record stable samples with actual timestamps; keep gaps and discard untimestamped legacy history.
- Persist task execution inputs independently from the public view, mark unsupported legacy recovery and expose persistence errors.
- Use verified task-owned staging for upload/download/local relay; reject source changes and mismatched checksums before replacement. Normalize conflicting paths and lock directory/child targets.
- Honor cancellation before commit; retain manifests on cleanup failure. Restore TOFU persistence, session-only weak-backend credentials and safe validated legacy migration.
- Fail closed on damaged host-trust files or failed trust writes; block overwriting corrupt credential stores. Stop connection-time sweeps of other sessions' temporary direct-transfer keys/directories.
- Preserve the in-memory server list on failed configuration writes; validate imported lists before saving. Isolate the native test instance/data and verify packaged source/assets plus computed shell output.
- Wait for SSH handshake before connection reuse; deduplicate simultaneous SFTP requests.
- Keep rsync direct relay with staged local SFTP fallback; disable unsafe streaming tar/scp fallback.
- Update README positioning/download entry/media, add architecture/validation/benchmarks/localization/roadmap/contribution/security documents and issue forms.
- Add production browser checks, 10/30-session synthetic benchmarks, macOS verification CI and manual unsigned packaging without auto-publication.

Local checks passed: 76 behavioral tests, 22 browser checks and 9 Windows packaged native checks. The release provides the locally validated unsigned Windows x64 portable package. Real GPUs, remote rsync, OS key stores and macOS/Linux packaging remain separate validation gates. See [VALIDATION](docs/VALIDATION.md).
