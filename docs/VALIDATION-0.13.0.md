# Validation ledger — 0.13.0

## Completed local checks

- 179 regressions in 19 files: SQLite retention, physical space reclamation, migration, restart flushing, corrupt legacy input, GPU disappearance/recovery, clipping, extrema, weighted coverage and independent host polling, alongside existing SSH/transfer/security regressions.
- TypeScript renderer/backend checks, ESLint/Hooks, production build and loopback SSH/SFTP smoke checks passed.
- Production renderer: 22 workbench checks, 23 workflow checks, 7 navigation checks, 8 monitoring checks and 6 language loading/failure checks passed.
- 60 browser layout combinations passed, including all ten languages and both short/week history charts.
- Packaged Windows: 22 native terminal/IPC/database/restart checks and 36 native layout combinations at 100/125/150% scale passed. Test user data was isolated from the installed application.
- The navigation fixture uses 12,000 remote entries. Measured update frames were 4.3–6.9 ms and eight navigation interactions were 50–210 ms. This simulated workload does not guarantee identical timing on every host or PC.

## Retention and capacity

The database stores the last 24 hours of raw data and 30 days of minute summaries. Expired rows are deleted at startup and every 15 minutes; incremental vacuum and WAL checkpoint reclaim storage. Consequently the physical expiry deadline can lag retention by up to the cleanup interval while the app runs. Queries enforce retention immediately. The app stops monitoring when fully quit and shows gaps rather than fabricating observations.

The [standalone receipt](evidence/history-capacity-0.13.0.json) was generated with packaged Electron 44.5.1 / Node 24.21.0 / SQLite 3.53.4 using the exact production schema and indexes. It models the final retained state after seven days of two-second sampling, not a seven-day wall-clock deployment. Each card contributes utilization, memory percentage, memory used/total, temperature and power.

| Scope | Raw rows (24h) | Minute rows (7d) | Database + WAL + SHM |
| --- | ---: | ---: | ---: |
| One GPU, six series | 259,200 | 60,480 | 11,890,688 bytes / 11.34 MiB |
| One GPU plus three shared host series | 388,800 | 90,720 | 17,481,728 bytes / 16.67 MiB |

Shared host series are charged once per host, not once per GPU. File sizes depend on identifier lengths, values, SQLite page utilization and temporary WAL growth. More frequent sampling increases the raw part; the minute part depends on retained duration.

SQLite's page cache target is 4 MiB. The measured weekly single-series response contained 673 points and approximately 63 KiB of JSON. Query heap growth in the standalone utility was approximately 3.2–3.4 MiB. Its batch RSS includes generating and writing 302,400 synthetic samples and is not a measurement of normal desktop RAM. Electron windows, terminals and other application state add separate memory usage; whole-app long-running RAM has not been characterized by this measurement.

## Platform and publication

Fresh three-platform source/package workflow results and public artifact receipts will be recorded after completion. Local checks alone do not establish macOS/Linux execution or installer upgrade behavior. Previously completed transfer/crash receipts remain evidence for their original version; this release's new history implementation does not re-label those old receipts as fresh production monitoring tests.
