# Workspaces and operational tools

ServerConsole combines SSH monitoring, a retained terminal, and SFTP with tools
for an experiment's lifecycle. Open **Workbench**, then select the intended server.
Read the server label and connection/sample state before operating a task.

## Experiment workspaces

Save a name, server and absolute remote working directory. Optional fields include
GPU selection, task reference, tmux session, log path and service ports. Saving a
workspace records context; it does not execute its commands or reserve its GPUs.
Use explicit terminal/file actions to enter the saved context. Only open a tmux
session after checking its server and session name. A remote process survives a
desktop restart only when managed remotely, for example with tmux or a task runner.

Terminal search acts on retained terminal output. Split layouts and names belong
to the selected server. Closing a terminal and stopping a remote experiment are
different actions: inspect the task or remote session to determine its state.

## Tasks, logs, alerts and services

Create a task with an absolute directory and explicit command. Inspect its output
and actual exit code. A failed status request is an unknown state, and a failed
stop request must not be displayed as success. Process identity is checked before
sending termination signals; PID alone cannot identify an old process safely.

Log monitors read appended data incrementally with bounded buffers. Rotation or
truncation resets the offset. Use a narrowly scoped file and matching expressions
to extract training step/epoch/loss. Bounded reading can skip an excessive backlog;
the UI should expose skipped data rather than imply complete log capture.

GPU-availability notifications observe conditions over time. They do not reserve
a card. Alert rules support sustained conditions and recovery; offline status must
reach the same rule evaluator. HTTPS webhook delivery is optional and disabled
until the user saves/enables it. Test delivery explicitly. Tokens remain local and
are excluded from configuration exports. Delivery errors and cooldowns do not
change the underlying monitoring condition.

Jupyter, TensorBoard and web-service templates use explicit launches and localhost
SSH forwards. A forwarded port does not start the server process automatically.
Bind remote services to loopback and keep their own authentication enabled.

## History and reports

Open **History** from a server or overview card. Choose 30 minutes, one hour,
12 hours, one day or seven days. Select devices/metrics, compare GPUs, inspect
timestamps, zoom, and export the displayed data. Disk rates are per device and
must not be summed across both a whole disk and its partitions. Missing data
remains a gap; interpolated display motion is not an additional observation.

Reports use persisted history and its coverage. They are not billing records.
User GPU time excludes disconnected intervals and does not prove exclusive use.
Raw observations expire after 24 hours; minute summaries and usage data expire
after 30 days. The separately started [headless collector](HEADLESS-MONITOR.md)
can store its own history on an always-on machine while the desktop is closed.

## File synchronization

Select source, destination, direction and exclusions, then generate a preview.
Review additions, updates and any proposed deletions before applying. Delete
extraneous files only when explicitly requested and after the copy phase succeeds.
The preview is revalidated before use; it does not lock either directory.

Save-and-upload tracks detected changes, queueing, uploading, success and errors.
Its successful timestamp changes only after the associated transfers complete.
Pausing cancels pending local changes; it does not claim already-running uploads
were canceled. Symlinks and excluded trees are skipped, and scan limits require
choosing a smaller directory or stronger exclusions.

## Diagnostics and Slurm

Diagnostics check SSH, readable procfs and available NVIDIA/rsync/tmux/Slurm tools,
plus SFTP capability. This operation does not install packages or write remote
test files. Diagnostic export omits credentials and redacts recognized secrets.
Review free-text content before sharing an export.

Slurm inspection is read-only: list jobs, fetch details with `scontrol`, and tail
the scheduler-declared stdout file. A host without Slurm returns unavailable.
The application does not submit, cancel, reserve or change scheduler jobs through
this feature. File permissions and site policies still apply.

## Configuration backup and migration

Export configuration, then store the JSON privately. Exports contain connection
addresses and key-file references, workspaces and selected rules/templates/layout
preferences; they omit passwords, passphrases, private-key contents, environment
secrets and webhook URLs. Review command templates for application-specific
secrets that pattern-based redaction cannot recognize.

Import first previews section counts. Apply only after reviewing that preview.
Import merges configuration and retains a local pre-import recovery export;
imported rules are disabled and schedules are not started. Rebind key paths and
enter credentials on the new computer. The recovery export is also credential-free,
so it cannot replace a separate secure backup of your own SSH keys.

For staging recovery, file-transfer guarantees and keyboard controls, see the
[complete usage guide](USER-GUIDE.md) and [security policy](../SECURITY.md).
