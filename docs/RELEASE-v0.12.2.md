## 0.12.2 — Reliable remote actions, language settings and direct-transfer recovery

- Remote process termination and service restart now require a successful SSH exit status. Permission failures, signals and missing statuses no longer appear successful.
- Share ten language catalogs between the renderer, native dialogs, tray and backend messages. Persist the selected language safely, preserve it on load/save failures and handle competing lazy language requests, including keyboard cancellation.
- Validate update HTTP responses, release payloads and stable version numbers before reporting update availability.
- Journal direct-transfer key ownership and relay recovery inputs before remote changes. After a crash, reconnect removes the exact owned public key and scratch directory. Cleanup failures retain actionable recovery records; concurrent key changes use an account lock.
- Honor SFTP bandwidth limits under backpressure and across concurrent streams; changing the limit wakes waiting streams. Direct rsync also honors the configured limit.
- Add regression coverage and an opt-in, isolated two-server packaged-desktop crash acceptance script.

Packages are unsigned. Windows SmartScreen may display a warning. Verify downloads against the attached SHA256SUMS.txt; signing and macOS notarization remain pending.

See [current validation and remaining limits](https://github.com/Moguifeng-9119/server-console/blob/main/docs/VALIDATION-0.12.2.md). Locale coverage does not imply complete native-speaker review.
