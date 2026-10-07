# Changelog

## 0.13.2 — 2026-10-07

- Fix overview GPU grids to four columns at all supported widths.
- Widen the preferred server card size; narrow cards shrink gauges and text spacing while retaining four columns.
- Verify 40 browser layout cases and the local Windows installer payload.

Local evidence: [0.13.2 validation ledger](docs/VALIDATION-0.13.2.md).


## 0.13.1 — 2026-10-07

- Use two GPU gauge columns by default and four in sufficiently wide server cards; never auto-fit odd column counts.
- Remove large filled GPU tiles, normalize ring sizes and improve metric text spacing.
- Validate 40 simulated GPU-count/window/theme combinations and existing monitoring interactions.

Evidence: [0.13.1 validation ledger](docs/VALIDATION-0.13.1.md).

## 0.13.0 — 2026-10-07

- Independent per-host polling and immediate cached panels prevent a slow host from blocking navigation.
- Retain visited file panes and reduce unrelated monitoring rerenders.
- Replace overview GPU widgets with circular utilization gauges that open and highlight the selected GPU.
- Expose history monitoring with five ranges from 30 minutes to one week, device/metric selectors, real timestamps and gaps.
- Persist samples in a SQLite worker, automatically expire 24-hour raw data and 30-day minute summaries, reclaim pages and import legacy JSON once.
- Add 15 backend regressions and eight monitoring UI checks; measure seven-day disk capacity using the production schema.

Evidence: [0.13.0 validation ledger](docs/VALIDATION-0.13.0.md).

## 0.12.3 — 2026-10-07

- Publish an assisted Windows NSIS installer as the primary Windows release download.
- Preserve terminal instances, scrollback, background output and per-server selected tabs across session/server/overview navigation.
- Maintain bounded terminal replay while attached and sequence live messages to avoid replay races; recover history on renderer reload.
- Select remaining sessions after close and discard terminal opens belonging to removed or updated server configurations.
- Cache directory sorts with a reusable collator, load local/remote paths independently and keep file/terminal tabs accessible without fresh metrics.
- Add seven responsive-navigation/race checks and extend native terminal checks from 16 to 21.

Scope and evidence: [0.12.3 validation ledger](docs/VALIDATION-0.12.3.md).

## 0.12.2 — 2026-10-06

- Require SSH command exit success for process termination and service restart; reject failures, signals and missing statuses.
- Reuse ten language catalogs for native/backend text, persist language safely, preserve preferences after resource failures and support keyboard cancellation of delayed switches.
- Reject failed HTTP update responses, malformed releases and invalid stable version numbers.
- Persist exact direct-transfer key ownership and relay execution inputs before remote changes; recover after crashes, serialize account key edits, preserve failed cleanup records and prevent removed tasks from resurrecting.
- Fix SFTP rate limiting under backpressure, shared concurrent accounting and live limit changes; apply limits to direct rsync.
- Add 58 regressions since 0.12.0, six production-language failure/race cases and an opt-in real two-server packaged-desktop acceptance harness.

Current evidence: [0.12.2 validation ledger](docs/VALIDATION-0.12.2.md). Packages remain unsigned.

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
