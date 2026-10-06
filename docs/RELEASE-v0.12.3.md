## 0.12.3 — Responsive navigation, persistent terminals and a Windows installer

**Windows:** download `ServerConsole-Setup-0.12.3.exe`, install once, then start ServerConsole from the desktop or Start menu. This release uses an assisted per-user NSIS installer with an installation-directory picker; it does not need to unpack the portable application at every launch. Existing user data uses the same application identity and directory.

- Retain every open terminal while switching sessions, servers, monitoring/file tabs or the overview. Background output remains in the original xterm scrollback, and each server remembers its selected tab.
- Keep bounded main-process output history even while a terminal is attached. Reattaching after a renderer reload restores displayed output; sequence checkpoints prevent replay/live races from duplicating messages.
- Select a remaining terminal after closing the active session. Reject obsolete terminal opens and close that server's sessions after a successful server removal or configuration update.
- Reuse a file-name collator and memoize directory sorting. Monitoring and transfer updates no longer sort both large directories repeatedly. Load local and remote directories independently, with visible errors.
- Keep terminal/file tabs available while monitoring is offline or waiting for a sample. Explicit GPU inspection actions still open GPU details.
- Add production-renderer navigation/race checks and native two-server, two-session, background-output and reload regressions.

Terminal continuity covers the running desktop application and renderer reloads; live SSH sessions are not restored after the entire application exits. Renderer scrollback is limited to 2,000 lines and main-process replay to 256 KiB of text per session.

Packages remain unsigned. Verify downloads against the attached `SHA256SUMS.txt`. Windows signing and macOS notarization remain pending. See the [validation ledger](https://github.com/Moguifeng-9119/server-console/blob/main/docs/VALIDATION-0.12.3.md) for the tested scope.
