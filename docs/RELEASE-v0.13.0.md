# ServerConsole v0.13.0

Server switching now displays cached metrics immediately, preserves visited file panes, and gives each host an independent polling schedule. Clicking a server's status dot or unused row space selects that server. A slow host no longer delays healthy hosts. Stale readings show their sample age and cannot enable destructive process actions.

The overview uses individual circular GPU utilization gauges with memory, temperature and owner details. Selecting a gauge opens and highlights that GPU.

History monitoring is available from each overview card and the server's History tab, with visible 30-minute, 1-hour, 12-hour, 1-day and 1-week ranges. Device and metric selectors expose GPU utilization, memory percentage, temperature, power, and system CPU/memory. Charts use real timestamps, missing-data gaps, extrema and time-weighted averages.

Monitoring is stored locally in `monitoring.sqlite`, with database work isolated in a worker. Raw samples expire after 24 hours; minute summaries expire after 30 days. Cleanup runs at startup and every 15 minutes and reclaims free database pages. Existing JSON history imports once. Closing the app stops sampling; historical observations that were never collected cannot be recreated.

A synthetic seven-day measurement using the production schema and packaged Electron runtime recorded 302,400 samples per GPU at two-second intervals. Six GPU series occupied 11.34 MiB including SQLite auxiliary files after checkpoint; one GPU plus three shared server series occupied 16.67 MiB. These are disk measurements, not whole-app RAM usage. See [capacity evidence](evidence/history-capacity-0.13.0.json) and the [validation ledger](VALIDATION-0.13.0.md).

Windows uses an assisted installer. Desktop packages remain unsigned; verify their SHA-256 against the release manifest. The validation ledger records completed platform checks and their limits.
