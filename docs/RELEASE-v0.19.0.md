# ServerConsole v0.19.0

This release connects explicitly launched tasks to persistent experiment runs,
training curves, logs and diagnostic evidence.

- Switch the home page between Resources and Experiments. The selected view is
  remembered; GPU resources retain the default four cards per row.
- Create a training run with a command, absolute directory, GPU selection,
  scalar JSON parameters and an optional total step count. Opening Experiments
  from a saved workspace fills its directory and GPUs without overwriting edits.
- Keep each launch's status, exit code, parameters, command and latest metric
  summaries in SQLite. Terminal and file actions reopen the run's directory.
- Parse JSONL and common key=value training logs in bounded workers. Display
  loss, validation metrics, learning rate, throughput and other numeric JSON
  metrics with uPlot; export the selected curve as CSV.
- Preserve repeated steps, non-finite values as gaps, downsampled extrema and
  missing counts. Estimate remaining time only when total steps and observed
  progress are available.
- Record OOM and NaN log evidence. A running task with healthy, caught-up log
  polling can record a ten-minute step stall. Disk evidence requires the remote
  physical working directory and its matching filesystem to be at least 95% full.
- Automatically track a unique output log for each run. Additional logs can be
  explicitly attached in the Logs tab; attachment imports the file from its
  beginning. Reused custom files are never assumed to belong to a new launch.
- Apply backpressure between parsing and SQLite batches. Retrying after a
  partial write deduplicates source positions before committing the log cursor.
- Keep task outcomes recoverable after transient storage errors. Explicit
  deletion of a reconciled run leaves a tombstone so stale task state cannot
  recreate it. Active or unknown runs must be reconciled before deletion.

Training points expire after 30 days. Run summaries, parameters and evidence
remain until deletion. Existing hardware retention remains 24 hours for raw
samples and 30 days for aggregated history. Before adding the research tables,
the existing database is backed up and validated; a bad backup stops migration.

The forms and charts load on demand. All ten interface languages and README
pages include the new entry points.

## Download

Use **ServerConsole-Setup-0.19.0.exe** on Windows, the DMG on macOS, or the
AppImage on Linux. Compare downloads with the attached SHA256SUMS.txt.
Windows packages are unsigned; macOS packages are unsigned/unnotarized and use
manual updating.

See the [validation ledger](VALIDATION-0.19.0.md) and
[workbench guide](WORKBENCH-GUIDE.md). Multi-run comparison, reproducibility
manifests, MLflow, desktop/headless integration, durable notification delivery,
Monaco and task/Slurm submission are subsequent roadmap stages.
