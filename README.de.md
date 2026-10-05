<div align="center">

# 🖥️ ServerConsole

English | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [日本語](./README.ja.md) | [한국어](./README.ko.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Deutsch](./README.de.md) | [Русский](./README.ru.md) | [Português (Brasil)](./README.pt-BR.md)

# 🖥️ ServerConsole

[English](./README.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [日本語](./README.ja.md) | [한국어](./README.ko.md) | [Español](./README.es.md) | [Français](./README.fr.md) | Deutsch | [Русский](./README.ru.md) | [Português (Brasil)](./README.pt-BR.md)

### Ein Desktop für Ihre GPU-Flotte: überwachen, Dateien durchsuchen und Daten **zwischen Servern mit voller Geschwindigkeit** verschieben — alles über SSH, vollständig lokal.

![license](https://img.shields.io/badge/license-MIT-22c55e)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-64748b)
![electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![react](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![typescript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![ssh](https://img.shields.io/badge/SSH-ssh2-4EA94B)
![ci](https://github.com/Moguifeng-9119/server-console/actions/workflows/ci.yml/badge.svg)

**ServerConsole** ist eine Local-First-Desktop-App, die mehrere Linux/GPU-Server zentralisiert:
Live-GPU- und Prozessüberwachung, einen Dual-Pane-SFTP-Dateimanager, Uploads/Downloads und
**hochgeschwindigkeits-Direktübertragung zwischen Servern** — gebaut mit Electron, React und [`ssh2`](https://github.com/mscdex/ssh2).
Keine Cloud, kein Datenrelay: Jede Verbindung läuft direkt von Ihrem Rechner.

  <p align="center">
    <img src="assets/screenshots/overview.png" alt="Fleet overview" width="880" />
  </p>
  <p align="center">
    <img src="assets/screenshots/gpu-panel.png" alt="GPU panel" width="430" />&nbsp;
    <img src="assets/screenshots/processes.png" alt="Process table" width="430" />
  </p>
</div>

---

## 📑 Inhaltsverzeichnis
- [✨ ✨ Highlights](#-highlights)(#-highlights)
- [🧱 🧱 Tech-Stack](#-tech-stack)(#-tech-stack)
- [🚀 🚀 Erste Schritte](#-getting-started)(#-getting-started)
- [🏗️ 🏗️ Build & Paketierung](#️-build--package)(#️-build--package)
- [🧭 🧭 Verwendung](#-usage)(#-usage)
- [🏛️ 🏛️ Funktionsweise](#️-how-it-works)(#️-how-it-works)
- [🔐 🔐 Sicherheit & Datenschutz](#-security--privacy)(#-security--privacy)
- [📁 📁 Datenspeicherung](#-data-storage)(#-data-storage)
- [🧪 🧪 Entwicklung](#-development)(#-development)
- [⚠️ ⚠️ Einschränkungen](#️-limitations)(#️-limitations)
- [🤝 🤝 Mitwirken](#-contributing)(#-contributing)
- [📄 📄 Lizenz](#-license)(#-license)

---

## ✨ ✨ Highlights

### 🧩 Multi-Server-Verwaltung
- **Password & private-key** auth (passphrase supported), with per-server connection tests.
- Credentials are encrypted at rest with the OS keychain (Windows DPAPI / libsecret) and **never leave your machine**.
- Sidebar with live reachability, **groups**, configurable auto-refresh (1 / 2 / 5 / 10 s) and Ctrl+K command palette.
- **Resizable sidebar** (180px–480px, double-click to reset to 224px, auto-persisted).
- **Differential polling scheduler**: Keeps high-frequency monitoring on the active server while downthrottling background nodes to $\ge 8$s, saving over 70% network and CPU overhead on large clusters.

### 🔑 One-Click-Import aus `~/.ssh/config`
- A **real React dialog** (no script injection) parses OpenSSH config: hosts, users, ports and `IdentityFile`s.
- Browse any config file, assign one shared key or a key per host; existing hosts are auto-skipped.
- **Watches the config file for changes** and shows a banner when hosts are added / changed / removed — import or update in one click; removed hosts are never deleted silently.

### 🧰 Ops-Werkzeugkasten
- **Embedded SSH terminal** per server (xterm.js): multiple sessions per server, Windows-style copy/paste (right-click, Ctrl+C/V, multi-line paste), scrollback preserved across tab switches.
- **Parallel commands**: run one command on N selected servers at once, per-server live output.
- **Local port forwarding** (ssh -L equivalent) with rule management and auto-restore.
- **Quick command snippets**, one-click from the server header.
- Alert **webhooks** (DingTalk / Feishu / WeCom), transfer **rate limit**, optional **MD5 verification**.
- **Remote text editing** with atomic save-back; relay "sync mode" (skip existing, rsync).
- ProxyJump bastions, keyboard-interactive (2FA/MFA) and ssh-agent auth; SSH compression; system tray.
- Encrypted config export/import; update check via GitHub Releases.

### 📊 Echte GPU- und Prozessüberwachung
- Dashboard KPIs: average GPU utilization, VRAM, CPU, memory, load average and zombie-process count.
- Per-GPU **utilization, VRAM, temperature, power and fan speed**, plus processes on each card.
- **4 / 8 / 16-GPU Compact Matrix View**: Toggle high-density matrix mode for HGX/DGX clusters to monitor all accelerators in a single view.
- Sortable / filterable process table (search by PID, user or command; GPU-only filter).
- Right-click a process for `SIGTERM` / `SIGKILL`, copy PID/command or restart a service — with confirmation and a **local audit log**.
- > Temperature, fan and power come **straight from `nvidia-smi`**. Fields the driver doesn't report show `N/A` — values are never estimated or fabricated.

### 🗂️ Dual-Pane-SFTP-Dateimanager
- **Local ⇄ remote** side-by-side panes: **resizable splitter** (drag to adjust ratio, double-click to reset to 50:50).
- **Professional keyboard shortcuts**: `Delete` for removal, `F2` to rename, `F5` to reload, `Ctrl+A` to select all, `Esc` to clear selection.
- **Remote permissions (`chmod`)**: Visual dialog to inspect and update octal permissions (e.g. 755/644).
- **Drag-and-drop upload**, batch upload/download, recursive folder transfer — folders are enqueued as a single task and transferred **while being walked** (no blocking pre-scan, even for huge trees).
- Right-click menu: download, view as text, rename, delete, **compress to `.tar.gz`**, extract (tar/zip), send to another server.
- Remote filename search in the current directory; double-click to descend; Ctrl-click to multi-select, **Shift-click for range selection**.

### ⚡ Server-zu-Server-Direktübertragung
- A **visual dual-pane picker** for source and destination — no manual path typing.
- Prefers a **direct server-to-server path that never bounces through your machine**. It probes both ends for `rsync / tar / scp` and picks the best, falling back automatically; only when neither supports it does it relay locally.
- Uses an **ephemeral one-time key pair** (generated at runtime, injected into `authorized_keys`, **shredded immediately after**). Your main private key is never used or uploaded.
- **Automatic Garbage Collection (GC)**: Scans and cleans orphaned temporary keys and directories from unexpected disconnections or client restarts.
- Large trees are streamed while being walked — no blocking pre-scan, no stuck "adding…".
- > A transfer is **always a copy**. Files on the source server are never deleted.

### 🚦 Transfercenter-Drawer
- A pinned **right-side drawer** (up to fullscreen) opened from a persistent top-bar button with a running-count badge; it stays open while tasks run.
- Header shows **live aggregate instant speed** (↑ upload / ↓ download / ⇄ relay), active count and overall progress.
- Filter by **type** (all/upload/download/relay) and **status** (all/active/done/failed).
- Expand any task for:
  - **60-second instant-speed sparkline** (instantaneous only — no averaged/peak numbers, no faking);
  - **ETA**, with an explicit "sizing…" state instead of a guess;
  - full **source → destination paths** with copy buttons;
  - a **direct/relay · rsync/tar/scp badge** and capability/fallback diagnostics;
  - **file x/y count** and a **recent-files stream** (rsync reports each finished file; locally filterable).
- Queue controls: pause/resume all, multi-select cancel, retry all failed, clear finished, **reorder queued tasks ↑/↓**, global **concurrency 1–15 (default 15)**, system notifications and an optional failure beep.

### 🎛️ Moderne, ruhige Benutzeroberfläche
- Dashboard styling with a **clean light theme by default** (follow-system / light / dark) and a cyan accent.
- **Windows title bar overlay theme synchronization**: Dynamic matching of native caption buttons with dark/light themes.
- **Full 10-language internationalization (i18n)**: English, Simplified/Traditional Chinese, Japanese, Korean, German, French, Spanish, Russian, Portuguese.
- Three density levels (**compact by default** / comfortable / roomy); theme and density are remembered only *after* you change them.
- Crash-safe persistence: transfer records are written atomically and trimmed to prevent oversized state files.

---

## 🧱 🧱 Tech-Stack

| Layer | Technology |
| --- | --- |
| Shell | **Electron 44** (CommonJS main process) |
| Renderer | **React 18 + TypeScript (strict) + Vite 5**, hand-written CSS design tokens (no heavy UI kit) |
| SSH / SFTP | [`ssh2`](https://github.com/mscdex/ssh2) — connections, SFTP, exec, keys |
| Packaging | `electron-builder` — Windows portable/NSIS, macOS dmg, Linux AppImage |

The main process owns all SSH/SFTP/local-file work and transfer scheduling; the renderer talks to it only through a controlled `preload` bridge (`window.api`) and never touches Node directly.

### Project layout
```
.
├─ electron/            # Main process (CommonJS, not type-checked by tsc)
│  ├─ main.cjs          #   app/window lifecycle, crash self-recovery
│  ├─ preload.cjs       #   controlled IPC bridge -> window.api
│  ├─ ipc.cjs           #   IPC handlers (servers, SFTP, transfers, notifications)
│  ├─ ssh.cjs           #   ssh2 wrapper: exec/execStream/SFTP/walk
│  ├─ sshconfig.cjs     #   parse & watch ~/.ssh/config
│  ├─ transfer.cjs      #   queue/concurrency, direct(rsync/tar/scp), relay, resume
│  ├─ localfs.cjs       #   local filesystem
│  └─ store.cjs         #   encrypted credential store (safeStorage + fallback)
├─ src/                 # Renderer (React + TS)
│  ├─ App.tsx state.tsx transfers.tsx api.ts types.ts format.ts
│  └─ components/       #   overview, server panel, file manager, relay, import, drawer…
├─ scripts/             # icon generator + a local mock SSH server
├─ build/ assets/       # app icons
└─ package.json
```

---

## 🚀 🚀 Erste Schritte

**Requirements:** Node.js ≥ 18 (developed on Node 22) and npm.

```bash
# 1. Install dependencies
npm install

# 2a. Frontend only in the browser (no main-process capabilities)
npm run dev

# 2b. Full desktop development (Vite + Electron)
npm run electron:dev
```

> On Windows PowerShell, chain commands with `;` instead of `&&`.

---

## 🏗️ 🏗️ Build & Paketierung

```bash
npm run build          # tsc strict type-check + Vite production build

npm run dist:win:lite  # Windows single-file portable .exe
npm run dist:win:nsis  # Windows NSIS installer
npm run dist:mac       # macOS universal dmg
npm run dist:linux     # Linux AppImage
```

<sub>Behind a slow network, point `ELECTRON_MIRROR` and `ELECTRON_BUILDER_BINARIES_MIRROR` to a local mirror.</sub>

---

## 🧭 🧭 Verwendung
1. **Server hinzufügen** — Host/Port/Benutzer eingeben, Passwort- oder Schlüsselauth wählen, optional *Verbindung testen*, dann speichern. Oder auf **Aus `~/.ssh/config` importieren** klicken.
2. Wählen Sie einen Knoten in der Seitenleiste, um die Tabs **Übersicht / GPU / Prozesse / Dateien** zu öffnen.
3. In **Dateien** zwischen den beiden Fenstern hoch-/herunterladen, oder entfernte Elemente auswählen → **Server-Relay ⇄** und Zielserver und -ordner im Dialog wählen.
4. Öffnen Sie die Schaltfläche **Übertragungen** in der oberen Leiste jederzeit für Live-Geschwindigkeit, Dateifortschritt und Warteschlangenverwaltung.

---

## 🏛️ 🏛️ Funktionsweise

```
┌────────────────────────────┐         IPC (window.api)        ┌──────────────────────────┐
│  Renderer (React + TS)     │  ◀──────────────────────────▶   │  Main process (Node)     │
│  dashboard / file manager  │                                 │  ssh2 · SFTP · scheduler │
└────────────────────────────┘                                 └───────────┬──────────────┘
                                                                             │ SSH
                                              ┌──────────────────────────────┼──────────────────────────────┐
                                              ▼                              ▼                              ▼
                                        source server                  destination server              your local disk
```

**Server-to-server transfer decision**

1. Probe source & destination capabilities (`rsync`, `tar`, `scp`).
2. Prefer **direct** transfer in the order `rsync → tar → scp`; stream finished filenames back for the x/y counter and recent-file list.
3. Fall back to a **local relay** only when direct transfer is impossible.
4. Count files and total size **asynchronously in the background** so the transfer starts immediately.

---

## 🔐 🔐 Sicherheit & Datenschutz
- **Host key verification (TOFU)**: the first connection records the server's host-key fingerprint; every later connection is verified against it and a mismatch is rejected with a clear warning. Direct server-to-server transfers carry the destination fingerprint into a temporary `known_hosts` on the source (`StrictHostKeyChecking=yes`). The trust store is manageable in *Settings → Security*.
- Direct-transfer keys are **ephemeral and shredded after use**; the main private key is never copied or uploaded.
- Relay is **copy-only** — source data is never deleted; **retry resumes from the breakpoint** instead of deleting the destination.
- Destructive actions (kill process, delete files) require confirmation and are appended to a **persistent local audit log** (`audit.log`, survives restarts).
- Passwords are encrypted with the OS safe-storage; only the *path* of a private key is stored, never its contents.
- Every metric and progress value comes from a real command response — **no fabricated temperature, speed or per-file progress**.

---

## 📁 📁 Datenspeicherung
All local data lives in the OS user-data directory (`%AppData%/server-console/` on Windows):
`servers.json` (connections), `transfers.json` (trimmed history), `hostkeys.json` (TOFU trust store), `security.json` (security options), `audit.log` (operations) and `error.log`.
Delete that folder to wipe all local state.

---

## 🧪 🧪 Entwicklung
```bash
npm run typecheck   # tsc strict (src) + checkJs (electron main process)
npm test            # vitest unit tests
npm run smoke       # e2e smoke: 2 mock sshd instances, real SFTP — collect/upload/download/relay/queue
```
CI runs all three before packaging.

Without a real GPU box, spin up the built-in **mock SSH server** — it returns fake `nvidia-smi` / `ps` output and serves a real SFTP root, listening on `127.0.0.1` only (any user/password):
```bash
npm run mock:ssh       # default port 2222 (set FAKE_SSH_PORT to override)
```

## ⚠️ ⚠️ Einschränkungen
- Direct transfer requires the two servers to be mutually reachable; otherwise it relays through your machine (bounded by your up/down bandwidth).
- Precise per-file progress requires `rsync` (or local relay); an `scp`-only fallback reports byte-level progress.
- GPU monitoring requires `nvidia-smi` to be installed and executable on the target host.
- Fully localized in 10 languages (switchable anytime in Settings).

---

## 🤝 🤝 Mitwirken
Issues and PRs are welcome. Please run `npm run build` (strict type-check) before opening a PR, and never commit real hosts, credentials or keys.

## 📄 📄 Lizenz
Distributed under the **[MIT License](./LICENSE)**.

<div align="center"><sub>Gebaut für Ingenieure, die viele GPU-Server verwalten und Übertragungen wollen, die schnell, ehrlich und sicher sind.</sub></div>
