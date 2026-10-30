# ServerConsole v0.18.1

This maintenance release fixes false success states, interrupted configuration
imports, stale monitoring after SSH reconnects, and terminal split interactions.

- Retain and retry save-and-upload changes when the 200-batch queue fills;
  isolate transfer listener errors and avoid duplicating already queued jobs.
- Distinguish failed GPU-process collection from an observed empty process list.
  Suspend usage accounting while occupancy is unavailable.
- Preserve per-module collection health. GPU failures no longer create disk or
  network history gaps, and one failed query does not imply an SSH disconnect.
- Reject late results and callbacks from replaced SSH connections, including
  cancelled jump-host setup.
- Execute log rules in bounded workers. New watchers default to text matching;
  a timed-out regex is disabled individually, with raw preview and visible error.
- Keep both terminal split positions stable when focusing or replacing sessions.
- Resolve new workspaces to an absolute remote home directory before saving.
- Keep committed backup imports applied when leaving the page. Persist import
  results, refresh the server list, and recover an interrupted multi-file import
  before loading the application configuration.
- Report notification delivery outcomes accurately, including disabled/cooldown.
- Package a real runtime tray icon. macOS includes DMG and ZIP artifacts; the
  current unsigned build offers manual updates.

## Download

Use the Windows **ServerConsole-Setup-0.18.1.exe** installer, the macOS DMG, or the
Linux AppImage attached to this release. Compare its SHA-256 with SHA256SUMS.txt.
Windows packages remain unsigned; macOS packages are not notarized.

See the [validation ledger](VALIDATION-0.18.1.md) and
[workbench guide](WORKBENCH-GUIDE.md). Persistent training runs and the subsequent
research-workbench expansion are separate stages and are not included here.

Automatic synchronization keeps a bounded pending set. A directory exceeding
10,000 pending paths requires narrowing/exclusions and an explicit full upload;
this condition remains visible until a complete scan and enqueue succeed.
