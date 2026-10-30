# ServerConsole

**Find a GPU with enough free memory, see who is using it, and open your experiment from one desktop.**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[Download](https://github.com/Moguifeng-9119/server-console/releases/latest) · [Issues](https://github.com/Moguifeng-9119/server-console/issues) · [Changelog](CHANGELOG.md)

![CI](https://github.com/Moguifeng-9119/server-console/actions/workflows/ci.yml/badge.svg)
![MIT](https://img.shields.io/badge/license-MIT-0891b2)

## What changes in 0.18.0

- Layered GPU/system/process collection is connected to the production scheduler. Unknown metrics stay unknown; timestamps and gaps are preserved. The overview keeps four GPU gauges per row.

- Saved experiment workspaces connect server, directory, GPU, tmux, logs and service references. Terminal search, split layouts and file shortcuts keep context visible.

- Task exit codes and stop results reflect remote execution. Process-start identity guards prevent targeting a reused PID. Offline rules and phone summaries receive connection-state changes.

- History covers 30 minutes, 1 hour, 12 hours, 1 day and 1 week, with multi-GPU comparison, disk/network metrics, exports and task/alert event markers. Raw data expires after 24 hours, summaries after 30 days.

- Use task cards, incremental training logs, GPU availability reminders, configurable alerts, containers and service tunnel templates. Slurm jobs/details/logs are read-only; availability depends on the host.

- Preview file synchronization and exclusions before applying changes. Save-and-upload distinguishes queued, uploading, success and failure; successful time is recorded only after transfer completion.

- Diagnostics and credential-free configuration backups help recovery and migration. HTTPS webhooks are optional and disabled by default. A separately started headless collector can retain history while the desktop is closed.

[0.18.1 release notes](docs/RELEASE-v0.18.1.md) · [Validation](docs/VALIDATION-0.18.1.md) · [Workspaces / tools guide](docs/WORKBENCH-GUIDE.md)

## Get started

Choose an attached package from Releases. Windows packages are unsigned and may trigger SmartScreen. Verify SHA-256 using the checksum file attached to that release. Packaging targets for macOS/Linux are verified only when the corresponding workflow and assets succeed.

Add or import an SSH connection, verify its fingerprint, then open Overview or Workbench. NVIDIA monitoring needs working nvidia-smi; Linux system monitoring reads /proc. Free VRAM is an observation, not a reservation.

[Detailed usage and recovery](docs/USER-GUIDE.md) · [Security](SECURITY.md) · [Headless collector](docs/HEADLESS-MONITOR.md)

## Development

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

The browser is a labelled simulated demo. Real SSH, terminals and SFTP require the Electron desktop process.

```sh
npm run electron:dev
```

React 18 · TypeScript · Electron · Vite · ssh2 · SQLite. [package.json](package.json) · [Architecture](docs/ARCHITECTURE.md)

```sh
npm run lint
npm run typecheck
npm test
npm run smoke
npm run build
npm run test:ui
npm run test:workflow
```

## Validation and scope

See the current validation ledger for exact commands, results and pending checks. Two real Linux SSH hosts exercised GPU streaming, all three sampling lanes, resource counters and an owned task returning exit code 7. These checks do not establish fleet performance, 100 GB transfer performance, real Slurm/MIG availability or every platform installer.

[Current validation ledger](docs/VALIDATION-0.18.1.md) · [Packaging workflow](.github/workflows/package.yml) · [Benchmark methodology](docs/BENCHMARKS.md)

## Languages and guides

The app and README offer ten languages. Machine-assisted translations still need native-speaker review. Remote output retains its original language. Screenshots below are historical simulated examples, not current performance evidence.

![GPU overview — historical simulated example](assets/screenshots/gpu-even-0.13.1-en.png)

[Localization](docs/LOCALIZATION.md) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE)
