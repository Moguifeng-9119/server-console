# Changelog

## 0.11.0 — source changes, not yet published

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

Local checks passed: 76 behavioral tests, 22 browser checks and 9 Windows packaged native checks. A local unsigned Windows preview is built separately from publication. Real GPUs, remote rsync, OS key stores and macOS/Linux packaging remain separate validation gates. See [VALIDATION](docs/VALIDATION.md).
