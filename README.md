<div align="center">

# 🖥️ ServerConsole

[English](./README.md) | [简体中文](./README.zh-CN.md)

### One desktop to monitor your GPU fleet, browse files, and move data **between servers at full speed** — all over SSH, fully local.

![license](https://img.shields.io/badge/license-MIT-22c55e)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-64748b)
![electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![react](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![typescript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![ssh](https://img.shields.io/badge/SSH-ssh2-4EA94B)

**ServerConsole** is a local-first desktop app that centralizes multiple Linux/GPU servers:
live GPU & process monitoring, a dual-pane SFTP file manager, uploads/downloads, and
**high-speed server-to-server direct transfer** — built with Electron, React and [`ssh2`](https://github.com/mscdex/ssh2).
No cloud, no relay of your data: every connection runs straight from your machine.

</div>

---

## 📑 Table of Contents
- [✨ Highlights](#-highlights)
- [🧱 Tech Stack](#-tech-stack)
- [🚀 Getting Started](#-getting-started)
- [🏗️ Build & Package](#️-build--package)
- [🧭 Usage](#-usage)
- [🏛️ How it works](#️-how-it-works)
- [🔐 Security & Privacy](#-security--privacy)
- [📁 Data storage](#-data-storage)
- [🧪 Development](#-development)
- [⚠️ Limitations](#️-limitations)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## ✨ Highlights

### 🧩 Multi-server management
- **Password & private-key** auth (passphrase supported), with per-server connection tests.
- Credentials are encrypted at rest with the OS keychain (Windows DPAPI / libsecret) and **never leave your machine**.
- Sidebar with live reachability and configurable auto-refresh (1 / 2 / 5 / 10 s).

### 🔑 One-click `~/.ssh/config` import
- A **real React dialog** (no script injection) parses OpenSSH config: hosts, users, ports and `IdentityFile`s.
- Browse any config file, assign one shared key or a key per host; existing hosts are auto-skipped.
- **Watches the config file for changes** and shows a banner when hosts are added / changed / removed — import or update in one click; removed hosts are never deleted silently.

### 📊 Real GPU & process monitoring
- Dashboard KPIs: average GPU utilization, VRAM, CPU, memory, load average and zombie-process count.
- Per-GPU **utilization, VRAM, temperature, power and fan speed**, plus processes on each card.
- Sortable / filterable process table (search by PID, user or command; GPU-only filter).
- Right-click a process for `SIGTERM` / `SIGKILL`, copy PID/command or restart a service — with confirmation and a **local audit log**.
- > Temperature, fan and power come **straight from `nvidia-smi`**. Fields the driver doesn't report show `N/A` — values are never estimated or fabricated.

### 🗂️ Dual-pane SFTP file manager
- **Local ⇄ remote** side-by-side panes: address bar, up / home / refresh, mkdir, sort by name/size/time.
- **Drag-and-drop upload**, batch upload/download, recursive folder transfer — folders are enqueued as a single task and transferred **while being walked** (no blocking pre-scan, even for huge trees).
- Right-click menu: download, view as text, rename, delete, **compress to `.tar.gz`**, extract (tar/zip), send to another server.
- Remote filename search in the current directory; double-click to descend; Ctrl-click to multi-select, **Shift-click for range selection**, `Ctrl/Cmd+A` select all, `Esc` clear.

### ⚡ Server-to-server direct transfer
- A **visual dual-pane picker** for source and destination — no manual path typing.
- Prefers a **direct server-to-server path that never bounces through your machine**. It probes both ends for `rsync / tar / scp` and picks the best, falling back automatically; only when neither supports it does it relay locally.
- Uses an **ephemeral one-time key pair** (generated at runtime, injected into `authorized_keys`, **shredded immediately after**). Your main private key is never used or uploaded.
- Large trees are streamed while being walked — no blocking pre-scan, no stuck "adding…".
- > A transfer is **always a copy**. Files on the source server are never deleted.

### 🚦 Transfer Center drawer
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

### 🎛️ Modern, calm UI
- Dashboard styling with a **clean light theme by default** (follow-system / light / dark) and a cyan accent.
- Three density levels (**compact by default** / comfortable / roomy); theme and density are remembered only *after* you change them.
- Crash-safe persistence: transfer records are written atomically and trimmed to prevent oversized state files.

---

## 🧱 Tech Stack

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

## 🚀 Getting Started

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

## 🏗️ Build & Package

```bash
npm run build          # tsc strict type-check + Vite production build

npm run dist:win:lite  # Windows single-file portable .exe
npm run dist:win:nsis  # Windows NSIS installer
npm run dist:mac       # macOS universal dmg
npm run dist:linux     # Linux AppImage
```

<sub>Behind a slow network, point `ELECTRON_MIRROR` and `ELECTRON_BUILDER_BINARIES_MIRROR` to a local mirror.</sub>

---

## 🧭 Usage
1. **Add a server** — enter host/port/user, choose password or key auth, optionally *Test connection*, then save. Or click **Import from `~/.ssh/config`**.
2. Pick a node in the sidebar to open its **Overview / GPU / Processes / Files** tabs.
3. In **Files**, upload/download between the two panes, or select remote items → **Server relay ⇄** and choose the destination server & folder in the dual-pane dialog.
4. Open the top-bar **Transfers** button any time for live speed, file progress and queue management.

---

## 🏛️ How it works

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

## 🔐 Security & Privacy
- **Host key verification (TOFU)**: the first connection records the server's host-key fingerprint; every later connection is verified against it and a mismatch is rejected with a clear warning. Direct server-to-server transfers carry the destination fingerprint into a temporary `known_hosts` on the source (`StrictHostKeyChecking=yes`). The trust store is manageable in *Settings → Security*.
- Direct-transfer keys are **ephemeral and shredded after use**; the main private key is never copied or uploaded.
- Relay is **copy-only** — source data is never deleted; **retry resumes from the breakpoint** instead of deleting the destination.
- Destructive actions (kill process, delete files) require confirmation and are appended to a **persistent local audit log** (`audit.log`, survives restarts).
- Passwords are encrypted with the OS safe-storage; only the *path* of a private key is stored, never its contents.
- Every metric and progress value comes from a real command response — **no fabricated temperature, speed or per-file progress**.

---

## 📁 Data storage
All local data lives in the OS user-data directory (`%AppData%/server-console/` on Windows):
`servers.json` (connections), `transfers.json` (trimmed history), `hostkeys.json` (TOFU trust store), `security.json` (security options), `audit.log` (operations) and `error.log`.
Delete that folder to wipe all local state.

---

## 🧪 Development
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

## ⚠️ Limitations
- Direct transfer requires the two servers to be mutually reachable; otherwise it relays through your machine (bounded by your up/down bandwidth).
- Precise per-file progress requires `rsync` (or local relay); an `scp`-only fallback reports byte-level progress.
- GPU monitoring requires `nvidia-smi` to be installed and executable on the target host.

---

## 🤝 Contributing
Issues and PRs are welcome. Please run `npm run build` (strict type-check) before opening a PR, and never commit real hosts, credentials or keys.

## 📄 License
Distributed under the **[MIT License](./LICENSE)**.

<div align="center"><sub>Built for engineers who manage many GPU servers and just want transfers to be fast, honest and safe.</sub></div>
