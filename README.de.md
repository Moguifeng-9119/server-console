# ServerConsole

**Finde eine GPU mit genügend freiem Speicher und öffne Experimente, Terminal und Dateien auf einem Desktop.**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[Download](https://github.com/Moguifeng-9119/server-console/releases/latest) · [Issues](https://github.com/Moguifeng-9119/server-console/issues) · [Changelog](CHANGELOG.md)

![CI](https://github.com/Moguifeng-9119/server-console/actions/workflows/ci.yml/badge.svg)
![MIT](https://img.shields.io/badge/license-MIT-0891b2)

## Neu in 0.19.0

- Persistente Trainingsläufe speichern Befehle, Parameter, Exit-Codes, JSONL/Text-Metriken, Kurven und Diagnosebelege. Die Startseite bietet Ressourcen und Experimente; Trainingsmetriken werden nach 30 Tagen automatisch gelöscht.

- GPU-, System- und Prozessmessungen sind in den tatsächlichen gestuften Scheduler eingebunden. Unbekannte Werte, Zeitstempel und Lücken bleiben erhalten. Die Übersicht zeigt vier GPU-Anzeigen pro Zeile.

- Experiment-Arbeitsbereiche speichern Server, Verzeichnis, GPU, tmux, Logs und Dienste. Terminalsuche, geteilte Ansichten und Dateiverknüpfungen erhalten den Kontext.

- Exitcodes und Stoppergebnisse entsprechen der entfernten Ausführung. Startkennungen schützen vor wiederverwendeten PIDs. Offlinezustände fließen in Regeln und mobile Übersicht ein.

- Verlauf für 30 Minuten, 1 Stunde, 12 Stunden, 1 Tag und 1 Woche mit GPU-Vergleich, Datenträger/Netzwerk, Exporten und Ereignissen. Rohwerte werden nach 24 Stunden, Minutenwerte nach 30 Tagen bereinigt.

- Aufgaben, inkrementelle Trainingslogs, freie GPUs, Regeln, Container und Tunnel. Slurm-Aufträge, Details und Logs sind nur lesbar und benötigen entsprechende Hostunterstützung.

- Änderungen und Ausschlüsse vor der Synchronisierung prüfen. Upload beim Speichern unterscheidet Warteschlange, Übertragung, Erfolg und Fehler; der Erfolgszeitpunkt wird erst nach Abschluss gesetzt.

- Diagnose und Konfigurationssicherung ohne Zugangsdaten helfen beim Umzug. HTTPS-Webhooks sind optional und zunächst aus. Ein separat gestarteter Headless-Sammler speichert Verlauf bei geschlossenem Desktop.

[0.19.0 release notes](docs/RELEASE-v0.19.0.md) · [Validation](docs/VALIDATION-0.19.0.md) · [Workspaces / tools guide](docs/WORKBENCH-GUIDE.md)

## Erste Schritte

Ein tatsächlich angehängtes Release-Paket wählen. Windows ist nicht signiert; SmartScreen kann warnen. SHA-256 mit derselben Veröffentlichung vergleichen. macOS/Linux gelten nur gemäß erfolgreichen Workflows und vorhandenen Dateien.

SSH hinzufügen/importieren und Fingerabdruck prüfen. GPU benötigt nvidia-smi, Systemwerte Linux /proc. Freier Speicher ist keine Reservierung.

[Detailed usage and recovery](docs/USER-GUIDE.md) · [Security](SECURITY.md) · [Headless collector](docs/HEADLESS-MONITOR.md)

## Entwicklung

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

Der Browser ist eine gekennzeichnete Simulation. Echtes SSH, Terminal und SFTP benötigen Electron.

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

## Prüfungen und Umfang

Das aktuelle Prüfprotokoll enthält Befehle, Ergebnisse und offene Prüfungen. Zwei reale Linux-Hosts prüften GPU-Stream, drei Ebenen, Zähler und eine eigene Aufgabe mit Exitcode 7. Flotten, 100GB-Transfers, echtes Slurm/MIG und alle Installer sind damit nicht geprüft.

[Current validation ledger](docs/VALIDATION-0.19.0.md) · [Packaging workflow](.github/workflows/package.yml) · [Benchmark methodology](docs/BENCHMARKS.md)

## Sprachen und Anleitungen

App und README bieten zehn Sprachen. Maschinell unterstützte Texte benötigen muttersprachliche Prüfung. Remoteausgabe bleibt unverändert. Bilder sind simulierte Beispiele älterer Versionen.

![GPU overview — historical simulated example](assets/screenshots/gpu-even-0.13.1-en.png)

[Localization](docs/LOCALIZATION.md) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE)
