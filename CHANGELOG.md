# Changelog

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
