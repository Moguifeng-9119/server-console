# ServerConsole v0.18.0

This release connects existing monitoring and workbench capabilities into complete
desktop workflows and corrects cases where the UI could report a misleading task,
resource or upload status.

- Production tiered GPU streaming, independent system/process sampling and bounded
  telemetry publication; fixed four-column GPU overview.
- Task exit/stop checks, process-start identity guards, complete settings retention,
  offline notifications, and phone-page VRAM units corrected.
- Historical resource comparison, event markers, exports and reports, with explicit
  missing coverage and automatic cleanup of expired monitoring/usage data.
- Experiment workspaces, retained terminal/file context, incremental training logs,
  GPU reminders, service forwards and container tools.
- Read-only Slurm inspection, diagnostics, credential-free configuration migration
  and opt-in HTTPS webhook notifications.
- Completion-based save-and-upload status and bounded symlink-safe traversal.
- Separate opt-in headless SSH collector with a token-authenticated read-only API.

See the [workbench guide](WORKBENCH-GUIDE.md), [headless guide](HEADLESS-MONITOR.md)
and [validation ledger](VALIDATION-0.18.0.md) for usage and exact validation scope.

## Downloads and verification

Download only assets attached to this release. Windows NSIS setup packages are
unsigned; SmartScreen may warn. Compare the download's SHA-256 against the attached
`SHA256SUMS.txt`. macOS and Linux build targets are included only after successful
platform packaging and native checks; their scripts alone do not establish a
published or tested installer. macOS packages are not notarized.

Keep configuration and SSH key backups before upgrading. Configuration migration
does not export credential values. Free GPU memory is an observation, not a
reservation; Slurm inspection does not modify scheduler state.

Real-host acceptance used two existing Linux SSH aliases and dedicated owned test
tasks. It does not establish large-fleet performance, 100GB transfer performance,
real Slurm/MIG support on every host, or native platform key-store behavior beyond
the evidence recorded in the ledger.
