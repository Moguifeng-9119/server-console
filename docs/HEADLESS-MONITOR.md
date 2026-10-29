# Optional headless monitoring

The desktop application remains an agentless SSH client. This separate CLI is an
explicitly started collector for users who need history while the desktop is
closed. Run it on an always-on computer with Node.js 22.13 or newer (built-in
SQLite support), OpenSSH, and an existing trusted SSH configuration. It does not
install anything on monitored servers, schedule itself, or execute saved tasks.

Create a JSON configuration:

```json
{
  "host": "127.0.0.1",
  "port": 9187,
  "intervalMs": 10000,
  "servers": [
    { "id": "lab-gpu", "alias": "my-trusted-ssh-alias", "name": "Lab GPU" }
  ]
}
```

Verify each SSH alias interactively first. Collection uses batch authentication
and strict host-key checking. Unknown keys, missing credentials, and authentication
errors produce offline samples rather than interactive prompts. SSH configuration
is trusted local configuration, including any configured ProxyCommand.

Set `SC_MONITOR_TOKEN` to a random secret of at least 32 bytes using the service
manager or environment, then start:

```text
node scripts/headless-monitor.cjs config.json /absolute/private/data-directory
```

PowerShell example (the token is generated locally and is not printed):

```powershell
$env:SC_MONITOR_TOKEN = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
node scripts/headless-monitor.cjs config.json C:\ServerConsoleData
```

Keep the data directory private. Stop with Ctrl+C/SIGTERM to close history storage.
Start it again with the same data directory to retain history. Raw samples expire
after one day, minute summaries after 30 days. Collection is 5–60 seconds per host;
this collector does not promise the desktop's high-frequency GPU rendering.

The HTTP API is read-only and requires `Authorization: Bearer <token>` on **every**
request. Credentials in query strings are rejected. Available endpoints:

* `GET /api/servers`: current snapshots, connection state, and timestamps.
* `GET /api/history?serverId=lab-gpu&device=all&metric=util&rangeMs=3600000`:
  the same history result structure as the desktop. Allowed ranges are 30 minutes,
  one hour, 12 hours, one day, and seven days.

There are no remote command, file transfer, configuration, or task-control HTTP
endpoints. Connections and queries are bounded. The default listener is localhost;
use an SSH tunnel to access it from another computer. If explicitly binding a
network interface, put it behind an authenticated HTTPS reverse proxy and restrict
the listener to that proxy. The CLI itself serves plain HTTP and does not manage
TLS certificates or firewall rules.

This mode stores monitoring history; it does not import desktop credentials,
automatically start experiments, or reserve GPUs. Desktop connection management
and the collector have separate lifecycle and configuration files.
